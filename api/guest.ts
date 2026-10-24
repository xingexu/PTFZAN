// A guest's stay: register, read it back, and every action in the guest app. Saved to Postgres.
// GET  /api/guest?id=…                         → { stay, now }
// POST { action: 'register', name, email?, party } → { stay, now }
// POST { action: <stay action>, id, …details }  → { stay, now }
// POST { action: 'end', id }                    → deletes the guest's data
import type { ServerResponse } from 'node:http';
import { activityFor, apply, cleanRegistration, newCode, STAY_ACTIONS, type Stay } from '../shared/guest/stay.js';
import { queryOf, readBody, send, type Req } from './_lib/http.js';
import { store } from './_lib/store.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = { ok: false, message: 'We couldn’t find that stay. Please register again.' };

/** Whether an action really changed something worth telling the hotel about. */
function changed(before: Stay, after: Stay, action: string) {
  if (action === 'check-in') return !before.checkInAt && !!after.checkInAt;
  if (action === 'unlock') return !before.inRoomAt && !!after.inRoomAt;
  if (action === 'issue' || action === 'request') return after.requests.length > before.requests.length;
  if (action === 'housekeeping') return before.housekeeping !== after.housekeeping;
  return false;
}

export default async function handler(req: Req, res: ServerResponse) {
  try {
    const db = store();
    if (req.method === 'GET') {
      const id = queryOf(req).get('id') ?? '';
      const stay = UUID.test(id) ? await db.get(id) : null;
      return stay ? send(res, 200, { ok: true, stay, now: Date.now() }) : send(res, 404, NOT_FOUND);
    }
    if (req.method !== 'POST') return send(res, 405, { ok: false, message: 'Use GET or POST' });

    let body: Record<string, unknown>;
    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { ok: false, message: 'Bad request' });
    }
    const action = String(body.action ?? '');
    const now = Date.now();

    if (action === 'register') {
      let input: ReturnType<typeof cleanRegistration>;
      try {
        input = cleanRegistration(body);
      } catch (e) {
        return send(res, 400, { ok: false, message: (e as Error).message });
      }
      const stay = await db.create({ ...input, code: newCode(), createdAt: now, housekeeping: 'standard', setpoint: 21, requests: [] });
      const line = activityFor(stay, 'register');
      if (line) await db.log(stay.id, line.kind, line.text, now);
      return send(res, 201, { ok: true, stay, now });
    }

    const id = String(body.id ?? '');
    const stay = UUID.test(id) ? await db.get(id) : null;
    if (!stay) return send(res, 404, NOT_FOUND);

    if (action === 'end') {
      await db.remove(stay.id);
      return send(res, 200, { ok: true });
    }
    if (!STAY_ACTIONS.includes(action as never)) return send(res, 400, { ok: false, message: 'Unknown action' });

    const before = structuredClone(stay);
    try {
      apply(stay, action, body, now);
    } catch (e) {
      return send(res, 409, { ok: false, message: (e as Error).message });
    }
    await db.save(stay, before.requests.length);
    const line = changed(before, stay, action) ? activityFor(stay, action) : null;
    if (line) await db.log(stay.id, line.kind, line.text, now);
    return send(res, 200, { ok: true, stay, now });
  } catch (e) {
    console.error('guest api', e);
    return send(res, 503, { ok: false, message: 'The hotel’s system didn’t answer. Please try again in a moment.' });
  }
}
