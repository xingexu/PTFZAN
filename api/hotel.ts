// The shared hotel day: one clock and one decision log for every screen, kept in Postgres.
// GET  /api/hotel?run=&after=&viewer=   → { control, events, serverNow, viewers }
// POST { action, minute, viewer, … }    → { control, events, serverNow }
//   actions: reset {mode} · demo · play {playing} · speed {speed} · next-event · approve {id} · dismiss {id}
//            auto-approve {value} · issue {roomId, issue}
// While anyone is watching, the server also refreshes the live tables (fhn.rooms, fhn.hotel_snapshot).
import type { ServerResponse } from 'node:http';
import { fmtTime } from '../shared/types.js';
import { ActionError, applyAction, Replay, type Control } from '../shared/sim/timeline.js';
import { queryOf, readBody, send, withDeadline, type Req } from './_lib/http.js';
import { store, type HotelStore, type RoomRow } from './_lib/store.js';

const SNAPSHOT_EVERY_MS = 4000;
const VIEWER = /^[A-Za-z0-9_-]{8,40}$/;

/** Rebuilds the day on the server and writes the live tables, if it's this request's turn. */
async function refreshTables(db: HotelStore, control: Control) {
  if (!(await db.claimSnapshot(SNAPSHOT_EVERY_MS))) return;
  const events = await db.events(control.run, 0);
  const replay = new Replay(true);
  replay.sync(control, events, Date.now());
  const s = replay.sim.state;
  const rooms: RoomRow[] = s.rooms.map((r) => ({
    id: r.id,
    floor: r.floor,
    type: r.type,
    wedding: !!r.groupBlock,
    status: r.status,
    ready_at_minute: r.readyAt ?? null,
    eta_low: r.eta?.low ?? null,
    eta_high: r.eta?.high ?? null,
    eta_confidence: r.eta?.confidence ?? null,
    hvac: r.hvac,
    attendant: r.cleaningBy ? (s.attendants.find((a) => a.id === r.cleaningBy)?.label ?? r.cleaningBy) : null,
  }));
  await db.writeSnapshot({
    run: control.run,
    mode: s.mode,
    minute: s.now,
    clock: fmtTime(s.now),
    playing: s.playing,
    finished: s.finished,
    metrics: s.metrics,
    compareMetrics: replay.shadow?.state.metrics ?? null,
    log: s.log.slice(0, 30),
    rooms,
  });
}

export default withDeadline(async function hotel(req: Req, res: ServerResponse) {
  try {
    const db = store().hotel;
    if (req.method === 'GET') {
      const q = queryOf(req);
      const control = await db.control();
      const run = Number(q.get('run'));
      const after = run === control.run ? Math.max(0, Number(q.get('after')) || 0) : 0;
      const viewer = q.get('viewer') ?? '';
      const events = await db.events(control.run, after);
      const viewers = VIEWER.test(viewer) ? await db.seen(viewer) : undefined;
      await refreshTables(db, control).catch((e) => console.error('hotel tables', e));
      return send(res, 200, { ok: true, control, events, serverNow: Date.now(), viewers, saved: store().kind });
    }
    if (req.method !== 'POST') return send(res, 405, { ok: false, message: 'Use GET or POST' });

    let body: Record<string, unknown>;
    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { ok: false, message: 'Bad request' });
    }
    const action = String(body.action ?? '');
    // Two screens acting at once: re-read and re-apply, so neither change is lost.
    for (let attempt = 0; attempt < 4; attempt++) {
      const cur = await db.control();
      let result: ReturnType<typeof applyAction>;
      try {
        result = applyAction(cur, action, body, Date.now());
      } catch (e) {
        if (e instanceof ActionError) return send(res, 400, { ok: false, message: e.message });
        throw e;
      }
      let control = cur;
      if (result.control !== cur) {
        const saved = await db.setControl(result.control, cur.version);
        if (!saved) continue;
        control = saved;
      }
      if (result.event) await db.addEvent({ ...result.event, run: control.run });
      const events = await db.events(control.run, 0);
      return send(res, 200, { ok: true, control, events, serverNow: Date.now() });
    }
    return send(res, 409, { ok: false, message: 'Another screen changed the day at the same moment. Try again.' });
  } catch (e) {
    console.error('hotel api', e);
    return send(res, 503, { ok: false, message: 'The hotel’s system didn’t answer. Please try again in a moment.' });
  }
});
