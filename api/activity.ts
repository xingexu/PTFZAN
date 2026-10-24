// What guests are doing in the app, for the hotel screen: GET /api/activity?after=<last id> → { items, counts, now }
import type { ServerResponse } from 'node:http';
import { queryOf, send, withDeadline, type Req } from './_lib/http.js';
import { store } from './_lib/store.js';

const DAY_MS = 24 * 3600_000;

export default withDeadline(async function activity(req: Req, res: ServerResponse) {
  if (req.method !== 'GET') return send(res, 405, { ok: false, message: 'Use GET' });
  try {
    const db = store();
    const after = Math.max(0, Number(queryOf(req).get('after')) || 0);
    const now = Date.now();
    const items = await db.activity(after, 30);
    const counts = await db.counts(now - DAY_MS);
    return send(res, 200, { ok: true, items, counts, now, saved: db.kind });
  } catch (e) {
    console.error('activity api', e);
    return send(res, 503, { ok: false, message: 'The hotel’s system didn’t answer.' });
  }
});
