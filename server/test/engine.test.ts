import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/engine.js';
import { TIME as t } from '../src/seed.js';

function runToEnd(mode: 'baseline' | 'readypath') {
  const sim = new Simulation(mode);
  sim.state.autoApprove = mode === 'readypath';
  let guard = 0;
  while (!sim.state.finished && guard++ < 2000) {
    if (!sim.tick()) {
      const p = sim.pendingProposal;
      if (p) sim.approve(p.id);
    }
  }
  return sim;
}

function at(mode: 'baseline' | 'readypath', minute: number) {
  const sim = new Simulation(mode);
  sim.state.autoApprove = true;
  while (sim.state.now <= minute && sim.tick()) {
    /* run */
  }
  return sim;
}

describe('Oct 16 simulation', () => {
  it('is deterministic', () => {
    const a = runToEnd('baseline').state.metrics;
    const b = runToEnd('baseline').state.metrics;
    expect(a).toEqual(b);
  });

  it('baseline reproduces the incident: large lobby queue, many wedding rooms unready at 3:45', () => {
    const s = at('baseline', t(15, 45));
    const m = s.state.metrics;
    console.log('baseline 15:45', m);
    expect(m.lobbyWaiting).toBeGreaterThanOrEqual(15);
    expect(m.groupRoomsNotReady).toBeGreaterThanOrEqual(6);
    expect(m.readinessCalls).toBeGreaterThan(3);
  });

  it('ReadyPath shrinks the lobby queue and informs guests', () => {
    const s = at('readypath', t(15, 45));
    const m = s.state.metrics;
    console.log('readypath 15:45', m);
    expect(m.lobbyWaiting).toBeLessThanOrEqual(8);
    expect(m.notificationsSent).toBeGreaterThan(10);
  });

  it('ReadyPath beats baseline over the full day', () => {
    const b = runToEnd('baseline').state.metrics;
    const r = runToEnd('readypath').state.metrics;
    console.log('end baseline', b);
    console.log('end readypath', r);
    expect(r.lobbyPeak).toBeLessThan(b.lobbyPeak);
    expect(r.avgWaitMin).toBeLessThan(b.avgWaitMin);
    expect(r.groupRoomsReadyBy1500).toBeGreaterThan(b.groupRoomsReadyBy1500);
    expect(r.etaAccuracyPct ?? 0).toBeGreaterThanOrEqual(75);
  });

  it('pauses for supervisor approval on the 13:15 group change when auto-approve is off', () => {
    const sim = new Simulation('readypath');
    while (sim.tick()) {
      /* run until blocked */
    }
    expect(sim.state.now).toBe(t(13, 15));
    expect(sim.pendingProposal?.trigger).toMatch(/Wedding/);
    expect(sim.state.playing).toBe(false);
    expect(sim.approve(sim.pendingProposal!.id)).toBe(true);
    expect(sim.tick()).toBe(true);
  });

  it('reporting an issue re-rooms the guest and notifies them (ReadyPath)', () => {
    const sim = at('readypath', t(14, 0));
    const target = sim.state.rooms.find((r) => r.groupBlock && r.status !== 'ready')!;
    const guest = sim.state.guests.find((g) => g.roomId === target.id)!;
    const res = sim.reportIssue(target.id, 'AC not cooling');
    expect(res.ok).toBe(true);
    expect(guest.roomId).not.toBe(target.id);
    expect(sim.state.notifications.some((n) => n.guestCode === guest.code && n.kind === 'room-change')).toBe(true);
  });

  it('guest view never exposes other guests', () => {
    const sim = at('readypath', t(13, 30));
    const v = sim.guestView('WED510')!;
    expect(v.guest.code).toBe('WED510');
    expect(JSON.stringify(v)).not.toContain('WED601');
  });

  it('demo guests get notified and survive a reset', () => {
    const sim = at('readypath', t(9, 0));
    const g = sim.addDemoGuest('Judge');
    expect(sim.state.notifications.some((n) => n.guestCode === g.code)).toBe(true);
    sim.reset('readypath');
    expect(sim.guestView(g.code)).not.toBeNull();
  });
});
