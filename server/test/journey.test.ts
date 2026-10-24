import { describe, expect, it } from 'vitest';
import { _internals, SECONDS_PER_HOTEL_MINUTE, type Journey } from '../../client/src/guest/journey.js';
import { HIST_AVG, INSPECTION_MIN } from '../../shared/sim/seed.js';

const { planFor, viewOf, apply, timeline } = _internals;
const T0 = new Date(2026, 9, 16, 14, 0, 0).getTime();
const hotelMin = (m: number) => m * SECONDS_PER_HOTEL_MINUTE * 1000;
const guest = (code = 'FHNTEST1'): Journey => ({ code, name: 'Sam Lee', party: 2, createdAt: T0, housekeeping: 'standard', setpoint: 21, requests: [] });
const checkedIn = (code?: string) => {
  const j = guest(code);
  apply(j, 'check-in', {}, T0);
  return j;
};

describe('guest stay', () => {
  it('calculates the wait from the room type, the attendant’s list and the final check', () => {
    const p = planFor('FHNTEST1');
    expect(p.predictedMin).toBe(p.queueMin + HIST_AVG[p.type] + INSPECTION_MIN);
    expect(planFor('FHNTEST1')).toEqual(p);
    expect(p.roomId).toMatch(/^[56]\d\d$/);
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
});
