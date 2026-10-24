import { describe, expect, it } from 'vitest';
import { chooseRoom } from '../../shared/guest/assign.js';
import { activityFor, apply, cleanRegistration, liveArrival, SECONDS_PER_HOTEL_MINUTE, timeline, viewOf, type Stay } from '../../shared/guest/stay.js';
import { HIST_AVG, INSPECTION_MIN } from '../../shared/sim/seed.js';

const T0 = new Date(2026, 9, 16, 14, 0, 0).getTime();
const hotelMin = (m: number) => m * SECONDS_PER_HOTEL_MINUTE * 1000;
const guest = (code = 'FHNTEST1', party = 2): Stay => ({ id: code, code, name: 'Sam Lee', party, createdAt: T0, housekeeping: 'standard', setpoint: 21, requests: [] });
/** Checks a guest in the way the server does: FHN AI chooses, given everyone already checked in. */
const checkIn = (j: Stay, at = T0, others: Stay[] = []) => {
  apply(j, 'check-in', { plan: chooseRoom(j, at, others) }, at);
  return j;
};
const checkedIn = (code?: string) => checkIn(guest(code));

describe('guest stay', () => {
  it('calculates the wait from the room type, the attendant’s list and the final check', () => {
    const p = checkedIn().plan!;
    expect(p.predictedMin).toBe(p.queueMin + HIST_AVG[p.type] + INSPECTION_MIN);
    expect(p.roomId).toMatch(/^[56]\d\d$/);
    expect(p.reasons?.length).toBeGreaterThan(3);
  });

  it('only checks in with the hotel’s decision', () => {
    expect(() => apply(guest(), 'check-in', {}, T0)).toThrow(/assigns your room/);
  });

  it('keeps every promise: the room is ready inside the window, never after its late end', () => {
    for (let i = 0; i < 300; i++) {
      const tl = timeline(checkedIn(`FHN${i}`))!;
      expect(tl.ready).toBeGreaterThanOrEqual(tl.low);
      expect(tl.ready).toBeLessThanOrEqual(tl.high);
    }
  });

  it('shows check-in first, with no messages yet', () => {
    const v = viewOf(guest(), T0);
    expect(v.guest.canCheckIn).toBe(true);
    expect(v.notifications).toHaveLength(0);
    expect(v.room.id).toBeNull();
  });

  it('gives a ready time at check-in, then sends each message when that moment comes', () => {
    const j = checkedIn();
    const tl = timeline(j)!;
    const atStart = viewOf(j, T0);
    expect(atStart.notifications.map((n) => n.id)).toEqual(['eta']);
    expect(atStart.notifications[0].body).toMatch(/will be ready by \d{1,2}:\d\d (AM|PM)/);
    expect(atStart.room.eta).not.toBeNull();
    expect(atStart.progress?.highMs).toBe(tl.high);

    const justBefore = viewOf(j, tl.ready - 1);
    expect(justBefore.room.status).toBe('inspection');
    expect(justBefore.notifications.some((n) => n.id === 'ready')).toBe(false);

    const ready = viewOf(j, tl.ready);
    expect(ready.room.status).toBe('ready');
    expect(ready.notifications[0].id).toBe('ready');
    expect(ready.room.eta).toBeNull();
    // Ready no later than the minute promised.
    expect(ready.room.readyAt!).toBeLessThanOrEqual(atStart.room.eta!.high);
  });

  it('opens requests only once the guest is in the room, and closes them on time', () => {
    const j = checkedIn();
    const tl = timeline(j)!;
    expect(() => apply(j, 'issue', { issue: 'AC not cooling' }, T0)).toThrow(/once you’re in your room/);
    expect(() => apply(j, 'unlock', {}, tl.ready - 1)).toThrow();
    apply(j, 'unlock', {}, tl.ready);
    const opened = tl.ready + 1000;
    apply(j, 'issue', { issue: 'AC not cooling' }, opened);
    expect(apply(j, 'issue', { issue: 'AC not cooling' }, opened + 1000)).toMatch(/Already reported/);
    expect(viewOf(j, opened).requests[0].status).toBe('assigned');
    expect(viewOf(j, opened + hotelMin(40)).requests[0].status).toBe('resolved');
  });

  it('saves energy while the room is empty and gets it ready before the guest walks in', () => {
    const j = checkedIn();
    const tl = timeline(j)!;
    expect(viewOf(j, T0).climate.hvac).toBe('eco');
    expect(viewOf(j, tl.ready - 1000).climate.hvac).toBe('precool');
    apply(j, 'unlock', {}, tl.ready);
    expect(viewOf(j, tl.ready).climate.hvac).toBe('comfort');
  });

  it('checks registrations the same way on the phone and the server', () => {
    expect(cleanRegistration({ name: '  Sam   <b>Lee ', party: 9 })).toEqual({ name: 'Sam bLee', email: undefined, party: 4 });
    expect(() => cleanRegistration({ name: ' ' })).toThrow(/name/);
    expect(() => cleanRegistration({ name: 'Sam', email: 'nope' })).toThrow(/email/);
  });

  it('tells the hotel what happened in plain words, first name only', () => {
    const j = checkedIn();
    expect(activityFor(j, 'check-in')?.text).toMatch(/^Sam checked in · FHN AI chose room \d{3} \(.+\), ready in about \d+ min$/);
    expect(activityFor(j, 'climate')).toBeNull();
  });

  it('gives the hotel screen the same clock as the guest’s phone', () => {
    const j = checkedIn();
    const a = liveArrival(j)!;
    const p = viewOf(j, T0).progress!;
    expect(a).toMatchObject({ first: 'Sam', roomId: j.plan!.roomId, startMs: p.startMs, cleanMs: p.cleanMs, checkMs: p.checkMs, readyMs: p.readyMs, highMs: p.highMs });
  });
});

describe('FHN AI check-in (server side)', () => {
  it('gives the first guest a room on the wedding floors, cleaned by the attendant on that floor', () => {
    const p = checkedIn().plan!;
    expect(p).toMatchObject({ type: 'King', position: 1 });
    expect(p.roomId).toMatch(/^[56]0[1-6]$/);
    expect(p.attendant).toBe(p.floor === 6 ? 'Attendant 4' : 'Backup attendant');
    // Walk to the room, the King average, the final check.
    expect(p.predictedMin).toBe(2 + HIST_AVG.King + INSPECTION_MIN);
  });

  it('never gives two waiting guests the same room, and spreads the work across the team', () => {
    const stays: Stay[] = [];
    for (let i = 0; i < 6; i++) stays.push(checkIn(guest(`FHNQ${i}`), T0 + i * 1000, stays));
    expect(new Set(stays.map((s) => s.plan!.roomId)).size).toBe(6);
    expect(new Set(stays.slice(0, 4).map((s) => s.plan!.attendantId)).size).toBe(4);
    // With all four attendants busy, the fifth guest waits behind someone — and is told so, with a wider window.
    const fifth = stays[4].plan!;
    expect(fifth.position).toBe(2);
    expect(fifth.queueMin).toBeGreaterThan(20);
    expect(fifth.bandMin).toBeGreaterThan(stays[0].plan!.bandMin);
    expect(fifth.reasons!.join(' ')).toMatch(/finishes 1 room first/);
  });

  it('keeps its promise for guests waiting behind others too', () => {
    for (let n = 0; n < 40; n++) {
      const stays: Stay[] = [];
      for (let i = 0; i < 8; i++) stays.push(checkIn(guest(`FHN${n}x${i}`), T0 + i * 3000, stays));
      for (const s of stays.filter((x) => x.plan!.position <= 3)) {
        const tl = timeline(s)!;
        expect(tl.ready).toBeLessThanOrEqual(tl.high);
      }
    }
  });

  it('gives a party of three or four a room with two beds or a suite', () => {
    for (let i = 0; i < 20; i++) expect(checkIn(guest(`FHNP${i}`, 4)).plan!.type).not.toBe('King');
  });

  it('moves to the other floors once the wedding block is full', () => {
    const stays: Stay[] = [];
    for (let i = 0; i < 21; i++) stays.push(checkIn(guest(`FHNF${i}`), T0 + i * 1000, stays));
    expect(stays.slice(0, 20).every((s) => /^[56]/.test(s.plan!.roomId))).toBe(true);
    const last = stays[20].plan!;
    expect(new Set(stays.map((s) => s.plan!.roomId)).size).toBe(21);
    expect(last.reasons![0]).toMatch(/wedding floors are full/);
  });

  it('decides the same way every time for the same hotel', () => {
    const a = chooseRoom(guest('FHNSAME'), T0, []);
    expect(chooseRoom(guest('FHNSAME'), T0, [])).toEqual(a);
  });
});
