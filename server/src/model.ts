// ReadyPath "AI" core: readiness prediction + constraint-aware re-sequencing.
//
// Prototype note: the predictor uses learned room-type averages plus queue simulation and an
// uncertainty band that widens with queue depth. In a pilot the averages become a gradient-boosted
// model trained on 60–90 days of room-level (never person-level) clean durations.
import type { Attendant, Confidence, Eta, PlanChange, Room, SimState } from '../../shared/types.js';
import { ELEVATOR_PENALTY, HIST_AVG, INSPECTION_MIN, STAYOVER_MIN } from './seed.js';

export const needsWork = (r: Room) =>
  r.status === 'occupied' || r.status === 'dirty' || (r.status === 'stayover' && !r.serviced);

export const predictedDuration = (r: Room) =>
  r.status === 'stayover' || r.serviceKind === 'stayover' ? STAYOVER_MIN : HIST_AVG[r.type];

/** When the planner believes the room can be entered (only uses information the PMS actually has). */
export function knownAvailableAt(r: Room, now: number): number {
  if (r.status === 'dirty') return now;
  if (r.status === 'stayover') return Math.max(now, r.guestOutAt ?? now);
  if (r.status === 'occupied') {
    if (r.lateReported && r.actualCheckout) return Math.max(now, r.actualCheckout);
    const sched = r.scheduledCheckout ?? now;
    return sched > now ? sched : now + 15; // overdue & unreported: assume soon
  }
  return now;
}

/** When the planner needs the room ready by. */
export function needBy(r: Room, s: Pick<SimState, 'guests' | 'groupConfirmed'>): number {
  if (r.status === 'stayover') return 16 * 60;
  const g = s.guests.find((x) => x.roomId === r.id && !x.isDemoGuest && x.state !== 'checked-in');
  if (!g) return 20 * 60;
  // Plan to the 3:00 PM check-in promise for every arrival, not to arrival guesses.
  // Group blocks carry more risk (simultaneous arrivals), so they lead once confirmed.
  if (g.group) return s.groupConfirmed ? 15 * 60 - 30 : 15 * 60 + 12;
  return 15 * 60 + Math.max(0, Math.round((g.expectedArrival - 15 * 60) / 10));
}

const travel = (from: number, to: number) => (from === to ? 1 : 4);
const elevator = (r: Room, down: boolean) => (down && r.floor >= 5 ? ELEVATOR_PENALTY : 0);

interface Cursor {
  t: number;
  floor: number;
  breakAt: number;
  hadBreak: boolean;
}

/** Where an attendant will be once their current task finishes (prediction, not ground truth). */
function startCursor(a: Attendant, rooms: Map<string, Room>, now: number): Cursor {
  let t = Math.max(now, a.busyUntil);
  let floor = a.lastFloor;
  const cur = a.currentRoom ? rooms.get(a.currentRoom) : undefined;
  if (cur && cur.status === 'cleaning' && cur.workStartedAt !== undefined) {
    // We do not peek at the true end time; we predict it like a real system would.
    const predEnd = cur.workStartedAt + predictedDuration(cur) + 2;
    t = Math.max(now + 2, predEnd);
    floor = cur.floor;
  }
  return { t, floor, breakAt: a.breakAt, hadBreak: a.hadBreak };
}

function band(position: number, r: Room, elevatorDown: boolean): number {
  return Math.round(4 + 3 * Math.sqrt(position) + (elevatorDown && r.floor >= 5 ? 3 : 0) + (r.status === 'occupied' && !r.lateReported ? 4 : 0));
}

const confidenceOf = (half: number): Confidence => (half <= 8 ? 'high' : half <= 13 ? 'medium' : 'low');

/** Predict ready-time ranges for every room given a set of attendant queues. */
export function predictEtas(s: SimState, queues?: Record<string, string[]>): Map<string, Eta> {
  const rooms = new Map(s.rooms.map((r) => [r.id, r]));
  const out = new Map<string, Eta>();
  const now = s.now;

  for (const r of s.rooms) {
    if (r.status === 'inspection' && r.workEndsAt !== undefined) {
      out.set(r.id, { low: Math.max(now, r.workEndsAt - 1), high: r.workEndsAt + 2, confidence: 'high', drivers: ['Clean finished — in inspection'] });
    } else if (r.status === 'cleaning' && r.workStartedAt !== undefined) {
      const end =
        Math.max(now + 2, r.workStartedAt + predictedDuration(r) + 2) + (r.serviceKind === 'stayover' ? 0 : INSPECTION_MIN);
      out.set(r.id, {
        low: end - 4,
        high: end + 5,
        confidence: 'high',
        drivers: [`Cleaning now (${r.type} avg ${HIST_AVG[r.type]} min)`, ...(elevator(r, s.elevatorDown) ? ['Elevator B outage adds cart time'] : [])],
      });
    }
  }

  for (const a of s.attendants) {
    if (!a.present) continue;
    const q = queues?.[a.id] ?? a.queue;
    const c = startCursor(a, rooms, now);
    let pos = 0;
    for (const id of q) {
      const r = rooms.get(id);
      if (!r || !needsWork(r) || r.status === 'ooo') continue;
      pos++;
      let start = Math.max(c.t, knownAvailableAt(r, now));
      if (!c.hadBreak && start >= c.breakAt) {
        start = Math.max(start, c.breakAt) + 30;
        c.hadBreak = true;
      }
      const end = start + travel(c.floor, r.floor) + elevator(r, s.elevatorDown) + predictedDuration(r);
      c.t = end;
      c.floor = r.floor;
      const ready = end + (r.status === 'stayover' ? 0 : INSPECTION_MIN);
      const half = band(pos, r, s.elevatorDown);
      const drivers: string[] = [];
      if (r.status === 'occupied') drivers.push(r.lateReported ? `Late checkout reported (${fmt(r.actualCheckout!)})` : `Guest checks out by ${fmt(r.scheduledCheckout!)}`);
      if (r.status === 'dirty') drivers.push('Vacant — waiting in queue');
      drivers.push(`#${pos} in ${a.label}'s queue`);
      drivers.push(`${r.type} average ${predictedDuration(r)} min`);
      if (elevator(r, s.elevatorDown)) drivers.push('Elevator B outage adds cart time');
      out.set(r.id, { low: ready - half, high: ready + half, confidence: confidenceOf(half), drivers });
    }
  }
  return out;
}

const fmt = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;

/**
 * Constraint-aware list scheduling: the attendant who frees up first takes the room with the best
 * score — earliest need-by time, least waiting for a checkout, fewest floor changes (which matters
 * more when an elevator is down). Absent attendants receive nothing.
 */
export function planQueues(s: SimState): Record<string, string[]> {
  const rooms = new Map(s.rooms.map((r) => [r.id, r]));
  const present = s.attendants.filter((a) => a.present);
  const queues: Record<string, string[]> = Object.fromEntries(s.attendants.map((a) => [a.id, [] as string[]]));
  const cursors = new Map(present.map((a) => [a.id, startCursor(a, rooms, s.now)]));
  const remaining = s.rooms.filter((r) => needsWork(r) && r.status !== 'ooo' && r.status !== 'cleaning');
  const floorWeight = s.elevatorDown ? 10 : 4;

  while (remaining.length && present.length) {
    const a = present.reduce((best, x) => (cursors.get(x.id)!.t < cursors.get(best.id)!.t ? x : best));
    const c = cursors.get(a.id)!;
    let bestIdx = 0;
    let bestScore = Infinity;
    remaining.forEach((r, i) => {
      const avail = knownAvailableAt(r, s.now);
      const wait = Math.max(0, avail - c.t);
      // Stickiness: keep rooms with the attendant who already has them unless there is a real gain,
      // so plans don't churn (attendants hate pointless reshuffles).
      const sticky = a.queue.includes(r.id) ? -12 : 0;
      const score = needBy(r, s) + 3 * wait + (r.floor !== c.floor ? floorWeight : 0) + sticky;
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    });
    const r = remaining.splice(bestIdx, 1)[0];
    let start = Math.max(c.t, knownAvailableAt(r, s.now));
    if (!c.hadBreak && start >= c.breakAt) {
      start = Math.max(start, c.breakAt) + 30;
      c.hadBreak = true;
    }
    c.t = start + travel(c.floor, r.floor) + elevator(r, s.elevatorDown) + predictedDuration(r);
    c.floor = r.floor;
    queues[a.id].push(r.id);
  }
  return queues;
}

/** Human-readable diff between the current plan and a proposed plan. */
export function diffPlans(s: SimState, proposed: Record<string, string[]>, trigger: string): PlanChange[] {
  const pos = (queues: Record<string, string[]>) => {
    const m = new Map<string, { att: string; idx: number }>();
    for (const [att, q] of Object.entries(queues)) {
      let i = 0;
      for (const id of q) {
        const r = s.rooms.find((x) => x.id === id);
        if (r && needsWork(r)) m.set(id, { att, idx: ++i });
      }
    }
    return m;
  };
  const current = pos(Object.fromEntries(s.attendants.map((a) => [a.id, a.queue])));
  const next = pos(proposed);
  const label = (att: string) => s.attendants.find((a) => a.id === att)?.label ?? att;
  const changes: (PlanChange & { weight: number })[] = [];

  for (const [id, n] of next) {
    const o = current.get(id);
    const moved = !o || o.att !== n.att || Math.abs(o.idx - n.idx) >= 2;
    if (!moved) continue;
    const r = s.rooms.find((x) => x.id === id)!;
    let reason = 'Rebalanced so the queue finishes sooner';
    if (r.groupBlock && s.groupConfirmed && (!o || n.idx < o.idx || o.att !== n.att)) reason = 'Wedding party now arrives 3:00 PM';
    else if (r.lateReported && r.status === 'occupied') reason = 'Late checkout — moved behind available rooms';
    else if (o && !s.attendants.find((a) => a.id === o.att)?.present) reason = `Covering for absent ${label(o.att)}`;
    else if (s.elevatorDown && r.floor >= 5) reason = `Batched on floor ${r.floor} to save elevator trips`;
    else if (r.status === 'dirty') reason = 'Vacant now — can start immediately';
    else if (r.status === 'stayover') reason = 'Stayover service moved after arrival rooms';
    changes.push({
      roomId: id,
      from: o ? `${label(o.att)} · #${o.idx}` : 'Unassigned',
      to: `${label(n.att)} · #${n.idx}`,
      reason,
      weight: (r.groupBlock ? 10 : 0) + (o ? Math.abs(o.idx - n.idx) : 5),
    });
  }
  void trigger;
  return changes.sort((a, b) => b.weight - a.weight).map(({ weight: _w, ...c }) => c);
}
