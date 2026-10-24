import { describe, expect, it } from 'vitest';
import { demoDurationSec, demoSpeedAt } from '../../shared/sim/demo.js';
import { Simulation } from '../../shared/sim/engine.js';
import { findRecurringFaults, forecastStaffing, normaliseRow } from '../../shared/sim/model.js';
import { HISTORY_AS_OF, IN_HOUSE_CODE, MAINTENANCE_HISTORY, TIME as t } from '../../shared/sim/seed.js';

function runToEnd(mode: 'baseline' | 'ai') {
  const sim = new Simulation(mode);
  sim.state.autoApprove = mode === 'ai';
  let guard = 0;
  while (!sim.state.finished && guard++ < 2000) {
    if (!sim.tick()) {
      const p = sim.pendingProposal;
      if (p) sim.approve(p.id);
    }
  }
  return sim;
}

function at(mode: 'baseline' | 'ai', minute: number) {
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

  it('today’s process reproduces Exhibit 4 at 3:45 PM: 40 guests waiting, 12 rooms still being prepared', () => {
    const s = at('baseline', t(15, 45));
    const m = s.state.metrics;
    expect(m.groupWaiting).toBe(40);
    expect(m.groupRoomsNotReady).toBe(12);
    expect(m.readinessCalls).toBeGreaterThan(3);
    expect(s.state.log.some((l) => l.text.startsWith('40 guests waiting. 12 rooms are still being prepared.'))).toBe(true);
  });

  it('follows the Exhibit 4 shift record, 08:00–17:00', () => {
    const sim = new Simulation('baseline');
    expect(sim.state.events.map((e) => e.at)).toEqual([t(8), t(10, 30), t(12), t(13, 15), t(14, 30), t(15), t(15, 45), t(17)]);
    expect(sim.state.start).toBe(t(8));
    expect(sim.state.end).toBe(t(17));
  });

  it('today’s process clears the check-in queue by 5 PM, as the log says — with staff pulled in', () => {
    const s = runToEnd('baseline').state;
    expect(s.metrics.lobbyWaiting).toBe(0);
    expect(s.metrics.groupRoomsNotReady).toBe(0);
    expect(s.tickets.find((x) => x.asset === 'Elevator B')!.status).toBe('open');
    expect(s.log.some((l) => l.at === t(17) && l.text.startsWith('Remaining group rooms released after cleaning and inspection. Check-in queue clears.'))).toBe(true);
  });

  it('FHN AI finishes the front desk by 5 PM: every room ready, every arrival in their room', () => {
    const s = runToEnd('ai').state;
    expect(s.rooms.filter((r) => ['occupied', 'dirty', 'cleaning', 'inspection'].includes(r.status) || (r.status === 'stayover' && !r.serviced))).toEqual([]);
    const notIn = s.guests.filter((g) => !g.inHouse && g.state !== 'checked-in');
    expect(notIn.every((g) => g.state === 'expected' && g.arrivalTime > s.end)).toBe(true);
  });

  it('FHN AI shrinks the lobby queue and informs guests', () => {
    const s = at('ai', t(15, 45));
    const m = s.state.metrics;
    console.log('ai 15:45', m);
    expect(m.lobbyWaiting).toBeLessThanOrEqual(8);
    expect(m.notificationsSent).toBeGreaterThan(10);
  });

  it('FHN AI beats baseline over the full day', () => {
    const b = runToEnd('baseline').state.metrics;
    const r = runToEnd('ai').state.metrics;
    console.log('end baseline', b);
    console.log('end ai', r);
    expect(r.lobbyPeak).toBeLessThan(b.lobbyPeak);
    expect(r.avgWaitMin).toBeLessThan(b.avgWaitMin);
    expect(r.groupRoomsReadyBy1500).toBeGreaterThan(b.groupRoomsReadyBy1500);
    expect(r.etaAccuracyPct ?? 0).toBeGreaterThanOrEqual(75);
  });

  it('pauses for supervisor approval on the 13:15 group change when auto-approve is off', () => {
    const sim = new Simulation('ai');
    while (sim.tick()) {
      /* run until blocked */
    }
    expect(sim.state.now).toBe(t(13, 15));
    expect(sim.pendingProposal?.trigger).toMatch(/Wedding/);
    expect(sim.state.playing).toBe(false);
    expect(sim.approve(sim.pendingProposal!.id)).toBe(true);
    expect(sim.tick()).toBe(true);
  });

  it('reporting an issue re-rooms the guest and notifies them (FHN AI)', () => {
    const sim = at('ai', t(14, 0));
    const target = sim.state.rooms.find((r) => r.groupBlock && r.status !== 'ready')!;
    const guest = sim.state.guests.find((g) => g.roomId === target.id)!;
    const res = sim.reportIssue(target.id, 'AC not cooling');
    expect(res.ok).toBe(true);
    expect(guest.roomId).not.toBe(target.id);
    expect(sim.state.notifications.some((n) => n.guestCode === guest.code && n.kind === 'room-change')).toBe(true);
  });

  it('guest view never exposes other guests', () => {
    const sim = at('ai', t(13, 30));
    const v = sim.guestView('WED510')!;
    expect(v.guest.code).toBe('WED510');
    expect(JSON.stringify(v)).not.toContain('WED601');
  });

  it('demo guests get notified and survive a reset', () => {
    const sim = at('ai', t(9, 0));
    const g = sim.addDemoGuest('Judge');
    expect(sim.state.notifications.some((n) => n.guestCode === g.code)).toBe(true);
    sim.reset('ai');
    expect(sim.guestView(g.code)).not.toBeNull();
  });

  it('demo guests can check in online later, then get an ETA', () => {
    const sim = at('ai', t(9, 0));
    const g = sim.addDemoGuest('Judge', { checkIn: false });
    expect(sim.state.notifications.some((n) => n.guestCode === g.code)).toBe(false);
    expect(sim.guestView(g.code)!.guest.canCheckIn).toBe(true);
    expect(sim.guestView(g.code)!.room.id).toBeNull();
    expect(sim.checkInOnline(g.code).ok).toBe(true);
    const v = sim.guestView(g.code)!;
    expect(v.room.id).not.toBeNull();
    expect(v.room.eta).not.toBeNull();
    expect(v.notifications[0].kind).toBe('eta');
  });
});

describe('One room-state signal, four challenges', () => {
  it('labour: no time lost knocking, and the sick call is covered at 8:00 instead of pulling staff in at 3:45', () => {
    const b = runToEnd('baseline');
    const r = runToEnd('ai');
    expect(b.state.metrics.attendantMinLost).toBeGreaterThan(60);
    expect(r.state.metrics.attendantMinLost).toBe(0);
    expect(b.state.metrics.pulledStaffMin).toBeGreaterThan(60);
    expect(r.state.metrics.pulledStaffMin).toBe(0);
    expect(at('ai', t(9)).state.attendants.find((a) => a.onCall)!.present).toBe(true);
    expect(at('baseline', t(9)).state.attendants.find((a) => a.onCall)!.present).toBe(false);
  });

  it('labour: tomorrow’s forecast turns overtime into a floater, and green choices shrink it', () => {
    const sim = new Simulation('ai');
    const f = sim.state.staffing;
    expect(f.overtimeHours).toBeGreaterThan(0);
    expect(f.recommendation).toMatch(/extra attendant/);
    const g = sim.addDemoGuest('Green');
    sim.guestHousekeeping(g.code, 'green');
    expect(sim.state.staffing.workloadHours).toBeLessThan(f.workloadHours);
    expect(forecastStaffing([]).workloadHours).toBe(f.workloadHours);
  });

  it('maintenance: the 411 AC is reported once and fixed faster, with an owner the guest can see', () => {
    const b = runToEnd('baseline');
    const r = runToEnd('ai');
    expect(b.state.metrics.repeatReports).toBe(1);
    expect(r.state.metrics.repeatReports).toBe(0);
    expect(r.state.metrics.acFixMin!).toBeLessThan(b.state.metrics.acFixMin!);
    const v = r.guestView(IN_HOUSE_CODE)!;
    expect(v.requests[0].owner).toBe('Maintenance technician');
    expect(v.requests[0].status).toBe('resolved');
    expect(v.notifications.map((n) => n.title)).toEqual(['Fixed', "We're on it"]);
  });

  it('maintenance: messy spreadsheet rows become recurring-fault flags', () => {
    expect(normaliseRow({ date: '2026-09-30', raw: 'Guest in 411 says room warm, AC fan only' })).toMatchObject({ asset: 'Room heating/cooling', location: 'Room 411', fault: 'not cooling' });
    expect(normaliseRow({ date: '2026-08-29', raw: 'Ice machine fl 4 leaking onto carpet' })).toMatchObject({ asset: 'Ice machine', location: 'Floor 4' });
    const flags = findRecurringFaults(MAINTENANCE_HISTORY, HISTORY_AS_OF);
    expect(flags.filter((f) => f.severity === 'high').map((f) => f.location).sort()).toEqual(['Elevator B', 'Room 411']);
  });

  it('energy: vacant rooms go to eco and are back to comfort before guests walk in', () => {
    const b = runToEnd('baseline').state.metrics;
    const r = runToEnd('ai').state.metrics;
    expect(b.kwhSaved).toBe(0);
    expect(b.vacantRunning).toBeGreaterThan(10);
    expect(r.kwhSaved).toBeGreaterThan(50);
    expect(r.vacantRunning).toBe(0);
    expect(r.preconditioned).toBeGreaterThanOrEqual(r.checkedIn / 2 - 2);
  });

  it('energy: an in-room guest is never set back unless they say they are out', () => {
    const sim = at('ai', t(14, 30));
    const room = sim.room('411')!;
    expect(room.hvac).toBe('comfort');
    sim.guestClimate(IN_HOUSE_CODE, { awayMinutes: 120 });
    expect(room.hvac).toBe('eco');
    sim.guestClimate(IN_HOUSE_CODE, { awayMinutes: null });
    expect(room.hvac).toBe('comfort');
  });

  it('guest issue reports open one ticket with an owner and a promised time', () => {
    const sim = runToEnd('ai');
    const g = sim.state.guests.find((x) => x.group && x.state === 'checked-in')!;
    const res = sim.guestReportIssue(g.code, 'TV not working');
    expect(res.ok).toBe(true);
    expect(sim.guestReportIssue(g.code, 'TV not working').message).toMatch(/Already reported/);
    const req = sim.guestView(g.code)!.requests[0];
    expect(req.owner).toBe('Maintenance technician');
    expect(req.etaAt).toBeGreaterThan(sim.state.now);
  });
});

describe('30-second demo', () => {
  it('replays the whole shift in about 30 seconds and slows down for the arrivals rush', () => {
    const sec = demoDurationSec();
    expect(sec).toBeGreaterThan(24);
    expect(sec).toBeLessThanOrEqual(30);
    expect(demoSpeedAt(t(15, 0))).toBeLessThan(demoSpeedAt(t(9, 0)));
  });
});
