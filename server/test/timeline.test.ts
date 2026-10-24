import { describe, expect, it, vi } from 'vitest';
import { demoDurationSec } from '../../shared/sim/demo.js';
import { SIM_START, TIME as t } from '../../shared/sim/seed.js';
import { ActionError, applyAction, initialControl, Replay, type Control, type TimelineEvent } from '../../shared/sim/timeline.js';

/** What a screen shows: the clock, every room, the plans and the day's numbers. */
const view = (r: Replay) => {
  const s = r.sim.state;
  return JSON.stringify({ now: s.now, rooms: s.rooms.map((x) => [x.id, x.status, x.readyAt]), plans: s.proposals.map((p) => [p.id, p.status]), metrics: s.metrics, shadow: r.shadow?.state.now });
};

/** A tiny server: one control record and a decision log, as the API keeps them. */
function timeline(start: Control = initialControl(0)) {
  let control = start;
  const events: TimelineEvent[] = [];
  return {
    get control() {
      return control;
    },
    events,
    act(action: string, body: Record<string, unknown>, nowMs: number) {
      const r = applyAction(control, action, body, nowMs);
      control = r.control;
      if (r.event) events.push({ ...r.event, id: events.length + 1 });
    },
  };
}

describe('shared hotel day', () => {
  it('a screen that followed the day and one that just opened show the same hotel', () => {
    const tl = timeline();
    tl.act('speed', { speed: 60, minute: SIM_START }, 0);
    tl.act('play', { playing: true, minute: SIM_START }, 0);
    const watcher = new Replay();
    // The watcher approves every plan the moment it comes up, as a supervisor would.
    for (let ms = 0; ms <= 9 * 60_000 && !watcher.sim?.state.finished; ms += 250) {
      watcher.sync(tl.control, tl.events, ms);
      const p = watcher.sim.pendingProposal;
      if (p) tl.act('approve', { id: p.id, minute: watcher.sim.state.now }, ms);
      const late = new Replay();
      if (ms % 15_000 === 0) {
        late.sync(tl.control, tl.events, ms);
        watcher.sync(tl.control, tl.events, ms);
        expect(view(late)).toBe(view(watcher));
      }
    }
    expect(tl.events.filter((e) => e.kind === 'approve').length).toBeGreaterThan(0);
    expect(watcher.sim.state.finished).toBe(true);
  });

  it('waits for the supervisor in manual playback, and moves on once a plan is approved', () => {
    const tl = timeline();
    tl.act('speed', { speed: 60, minute: SIM_START }, 0);
    tl.act('play', { playing: true, minute: SIM_START }, 0);
    const r = new Replay();
    r.sync(tl.control, tl.events, 10 * 60_000);
    const p = r.sim.pendingProposal!;
    expect(p).toBeTruthy();
    expect(r.sim.state.playing).toBe(false);
    expect(r.sim.state.pausedReason).toMatch(/approval/i);
    const waitingAt = r.sim.state.now;
    tl.act('approve', { id: p.id, minute: waitingAt }, 10 * 60_000);
    r.sync(tl.control, tl.events, 10 * 60_000 + 2000);
    expect(r.sim.state.now).toBeGreaterThan(waitingAt);
    expect(r.sim.state.proposals.find((x) => x.id === p.id)?.status).toBe('approved');
  });

  it('a decision that arrives late is replayed at the minute it was made', () => {
    const tl = timeline();
    tl.act('speed', { speed: 60, minute: SIM_START }, 0);
    tl.act('play', { playing: true, minute: SIM_START }, 0);
    const r = new Replay();
    r.sync(tl.control, tl.events, 60_000);
    // Another screen reported a problem at 8:30, but this screen only hears about it now (minute ~ 9:00).
    tl.act('issue', { roomId: '305', issue: 'TV not working', minute: t(8, 30) }, 60_000);
    r.sync(tl.control, tl.events, 61_000);
    const fresh = new Replay();
    fresh.sync(tl.control, tl.events, 61_000);
    expect(view(r)).toBe(view(fresh));
    expect(r.sim.state.log.some((l) => /305/.test(l.text))).toBe(true);
  });

  it('runs the 30-second demo on the same schedule everywhere, and keeps its progress when stopped', () => {
    const tl = timeline();
    tl.act('demo', {}, 1000);
    const a = new Replay();
    for (let ms = 1000; ms <= 1000 + 15_000; ms += 100) a.sync(tl.control, tl.events, ms);
    const b = new Replay();
    b.sync(tl.control, tl.events, 16_000);
    expect(view(a)).toBe(view(b));
    expect(a.sim.state.autopilot).toBe(true);

    // Stop the demo partway: the plans it approved stay approved for screens that open later.
    const stoppedAt = a.sim.state.now;
    tl.act('play', { playing: false, minute: stoppedAt }, 16_000);
    expect(tl.control).toMatchObject({ autopilot: false, playing: false, autoApproveUntil: stoppedAt, speed: 20 });
    a.sync(tl.control, tl.events, 20_000);
    const c = new Replay();
    c.sync(tl.control, tl.events, 20_000);
    expect(view(c)).toBe(view(a));
    expect(c.sim.state.now).toBe(stoppedAt);

    const d = timeline();
    d.act('demo', {}, 0);
    const end = new Replay();
    end.sync(d.control, d.events, demoDurationSec() * 1000 + 500);
    expect(end.sim.state.finished).toBe(true);
    expect(end.sim.state.proposals.every((p) => p.status === 'approved' || p.status === 'auto-applied')).toBe(true);
  });

  it('starting again begins a new run with the chosen method', () => {
    const tl = timeline();
    tl.act('reset', { mode: 'baseline' }, 5000);
    expect(tl.control).toMatchObject({ run: 2, mode: 'baseline', playing: false, anchorMinute: SIM_START });
    const r = new Replay();
    r.sync(tl.control, tl.events, 9000);
    expect(r.sim.state.mode).toBe('baseline');
    expect(r.shadow?.state.mode).toBe('ai');
    expect(r.sim.state.now).toBe(SIM_START);
  });

  it('rejects controls it doesn’t understand', () => {
    const c = initialControl(0);
    expect(() => applyAction(c, 'speed', { speed: 7, minute: SIM_START }, 0)).toThrow(ActionError);
    expect(() => applyAction(c, 'issue', { roomId: '999', minute: SIM_START }, 0)).toThrow(ActionError);
    expect(() => applyAction(c, 'launch', {}, 0)).toThrow(ActionError);
    expect(() => applyAction(c, 'play', { playing: true }, 0)).toThrow(ActionError);
    // A problem report is a decision, not a change to the clock.
    expect(applyAction(c, 'issue', { roomId: '412', issue: 'Leak', minute: SIM_START }, 0).control).toBe(c);
  });
});

// No DATABASE_URL: the API keeps the day in memory, so this never touches the real database.
vi.stubEnv('DATABASE_URL', '');
const { default: hotel } = await import('../../api/hotel.js');
type Reply = { ok: boolean; control: Control; events: TimelineEvent[]; serverNow: number; viewers?: number; message?: string };
const call = async (method: string, url: string, body?: object) => {
  const res = { statusCode: 0, body: '', setHeader: () => undefined, end(s: string) { this.body = s; } };
  await hotel({ method, url, body } as never, res as never);
  return { status: res.statusCode, data: JSON.parse(res.body) as Reply };
};

describe('hotel API', () => {
  it('keeps one day for every screen', async () => {
    const first = await call('GET', '/api/hotel?run=0&after=0&viewer=screen-one-1234');
    expect(first.status).toBe(200);
    const run = first.data.control.run;
    expect(first.data.viewers).toBe(1);
    expect((await call('GET', '/api/hotel?viewer=screen-two-5678')).data.viewers).toBe(2);

    const played = await call('POST', '/api/hotel', { action: 'play', playing: true, minute: t(9, 0) });
    expect(played.data.control).toMatchObject({ playing: true, anchorMinute: t(9, 0), version: first.data.control.version + 1 });

    await call('POST', '/api/hotel', { action: 'issue', roomId: '503', issue: 'AC not cooling', minute: t(9, 5) });
    const later = await call('GET', `/api/hotel?run=${run}&after=0`);
    expect(later.data.control.playing).toBe(true);
    expect(later.data.events.map((e) => [e.kind, e.data.roomId])).toEqual([['issue', '503']]);
    // Only what a screen hasn't seen yet.
    expect((await call('GET', `/api/hotel?run=${run}&after=${later.data.events[0].id}`)).data.events).toEqual([]);

    const reset = await call('POST', '/api/hotel', { action: 'reset', mode: 'ai' });
    expect(reset.data.control.run).toBe(run + 1);
    expect(reset.data.events).toEqual([]);
  });

  it('turns away controls that make no sense', async () => {
    expect((await call('POST', '/api/hotel', { action: 'speed', speed: 999, minute: SIM_START })).status).toBe(400);
    expect((await call('POST', '/api/hotel', { action: 'nope' })).status).toBe(400);
    expect((await call('PUT', '/api/hotel')).status).toBe(405);
  });
});
