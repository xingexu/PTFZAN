// What guests are doing in the app, for the hotel screen:
// GET /api/activity?after=<last id> → { items, counts, arrivals, now } — arrivals carry the same clock as each guest's phone
import type { ServerResponse } from 'node:http';
import { HOLD_MS } from '../shared/guest/assign.js';
import { liveArrival, type LiveArrival } from '../shared/guest/stay.js';
import { queryOf, send, withDeadline, type Req } from './_lib/http.js';
import { store } from './_lib/store.js';
import { requireAdmin } from './_lib/admin-auth.js';

const DAY_MS = 24 * 3600_000;

export default withDeadline(async function activity(req: Req, res: ServerResponse) {
  if (req.method !== 'GET') return send(res, 405, { ok: false, message: 'Use GET' });
  try {
    if (!(await requireAdmin(req, res))) return;
    const db = store();
    const after = Math.max(0, Number(queryOf(req).get('after')) || 0);
    const now = Date.now();
    const items = await db.activity(after, 30);
    const counts = await db.counts(now - DAY_MS);
    const arrivals = (await db.arrivals(now - HOLD_MS, 8)).map(liveArrival).filter((a): a is LiveArrival => !!a);
    return send(res, 200, { ok: true, items, counts, arrivals, now, saved: db.kind });
  } catch (e) {
    console.error('activity api', e);
    return send(res, 503, { ok: false, message: 'The hotel’s system didn’t answer.' });
  }
});
