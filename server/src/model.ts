// FHN AI core: readiness prediction + constraint-aware re-sequencing, plus the two models that reuse
// the same room-level data — tomorrow's staffing forecast and recurring-fault detection.
//
// Prototype note: the predictor uses learned room-type averages plus queue simulation and an
// uncertainty band that widens with queue depth. In a pilot the averages become a gradient-boosted
// model trained on 60–90 days of room-level (never person-level) clean durations.
import type { Attendant, Confidence, Eta, Guest, MaintenanceInsight, PlanChange, Room, SimState, StaffingForecast } from '../../shared/types.js';
import { ELEVATOR_PENALTY, HIST_AVG, INSPECTION_MIN, STAYOVER_MIN, TOMORROW } from './seed.js';

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
  const base = g.group ? (s.groupConfirmed ? 15 * 60 - 30 : 15 * 60 + 12) : 15 * 60 + Math.max(0, Math.round((g.expectedArrival - 15 * 60) / 10));
  // A time already promised to a guest becomes a deadline, so re-plans never quietly break it.
  return r.promisedBy !== undefined ? Math.min(base, r.promisedBy - 15) : base;
}

const travel = (from: number, to: number) => (from === to ? 1 : 4);
/** A room that would start this close to a due break is assumed to wait for it (an overrun makes that likely). */
const BREAK_SLACK = 20;
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
  return Math.round(6 + 4 * Math.sqrt(position) + (elevatorDown && r.floor >= 5 ? 3 : 0) + (r.status === 'occupied' && !r.lateReported ? 4 : 0));
}

const confidenceOf = (half: number): Confidence => (half <= 10 ? 'high' : half <= 16 ? 'medium' : 'low');

/** Predict ready-time ranges for every room given a set of attendant queues. */
export function predictEtas(s: SimState, queues?: Record<string, string[]>): Map<string, Eta> {
  const rooms = new Map(s.rooms.map((r) => [r.id, r]));
  const out = new Map<string, Eta>();
  const now = s.now;

  for (const r of s.rooms) {
    if (r.status === 'inspection' && r.workEndsAt !== undefined) {
      out.set(r.id, { low: Math.max(now, r.workEndsAt - 1), high: r.workEndsAt + 2, confidence: 'high', drivers: ['Cleaned — final check under way'] });
    } else if (r.status === 'cleaning' && r.workStartedAt !== undefined) {
      const end =
        Math.max(now + 2, r.workStartedAt + predictedDuration(r) + 2) + (r.serviceKind === 'stayover' ? 0 : INSPECTION_MIN);
      out.set(r.id, {
        low: end - 4,
        high: end + 5,
        confidence: 'high',
        drivers: [`Being cleaned now (${r.type} rooms take about ${HIST_AVG[r.type]} min)`, ...(elevator(r, s.elevatorDown) ? ['Elevator B is out — carts take longer'] : [])],
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
      if (!c.hadBreak && start >= c.breakAt - BREAK_SLACK) {
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
      if (r.status === 'dirty') drivers.push('Empty — waiting its turn');
      drivers.push(`${ordinal(pos)} on ${a.label}'s list`);
      drivers.push(`${r.type} rooms take about ${predictedDuration(r)} min`);
      if (elevator(r, s.elevatorDown)) drivers.push('Elevator B is out — carts take longer');
      out.set(r.id, { low: ready - half, high: ready + half, confidence: confidenceOf(half), drivers });
    }
  }
  return out;
}

const fmt = (m: number) => `${((Math.floor(m / 60) + 11) % 12) + 1}:${String(m % 60).padStart(2, '0')}`;
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

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
    if (!c.hadBreak && start >= c.breakAt - BREAK_SLACK) {
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
    let reason = 'Evened out so everyone finishes sooner';
    if (r.groupBlock && s.groupConfirmed && (!o || n.idx < o.idx || o.att !== n.att)) reason = 'Wedding party now arrives 3:00 PM';
    else if (r.lateReported && r.status === 'occupied') reason = 'Late checkout — empty rooms first';
    else if (o && !s.attendants.find((a) => a.id === o.att)?.present) reason = `Covering for ${label(o.att)} (off sick)`;
    else if (s.elevatorDown && r.floor >= 5) reason = `Grouped on floor ${r.floor} to save elevator trips`;
    else if (r.status === 'dirty') reason = 'Empty now — can start right away';
    else if (r.status === 'stayover') reason = 'Staying guest’s tidy-up moved after arrival rooms';
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

// ───────────────────────── Labour: tomorrow's staffing forecast ─────────────────────────

/** Productive cleaning hours per attendant shift (8 h minus briefing, breaks and cart travel). */
const PRODUCTIVE_HOURS = 6.5;
/** Full clean + inspection, weighted by the room mix (6 King · 4 Double Queen · 2 Suite per floor). */
const AVG_FULL_CLEAN = (6 * HIST_AVG.King + 4 * HIST_AVG['Double Queen'] + 2 * HIST_AVG.Suite) / 12 + INSPECTION_MIN;
/** Share of a block's hours an attendant spends cleaning (the rest is carts, travel, linen runs). */
const ON_FLOOR = 0.82;

/**
 * Workload = departures × full clean + stayovers × light service (minus guests who chose to skip it),
 * converted to attendants per block. Built only from reservations and room-type averages.
 */
export function forecastStaffing(guests: Guest[]): StaffingForecast {
  const greenChoice = guests.filter((g) => g.housekeeping !== 'standard' && !g.inHouse).length;
  const stayovers = Math.max(0, TOMORROW.stayovers - greenChoice);
  const minutes = TOMORROW.departures * AVG_FULL_CLEAN + stayovers * STAYOVER_MIN;
  const workloadHours = Math.round((minutes / 60) * 10) / 10;
  const attendantsNeeded = Math.ceil(workloadHours / PRODUCTIVE_HOURS);
  const overtimeHours = Math.max(0, Math.round((workloadHours - TOMORROW.scheduled * PRODUCTIVE_HOURS) * 10) / 10);
  // Departures follow the checkout curve; stayovers are serviced while guests are out.
  const blocks = TOMORROW.blocks.map((b) => {
    const load = (TOMORROW.departures * AVG_FULL_CLEAN * b.departShare + stayovers * STAYOVER_MIN * b.stayShare) / 60;
    return { label: b.label, load: Math.round(load * 10) / 10, attendants: Math.max(1, Math.ceil(load / (b.hours * ON_FLOOR))) };
  });
  const peak = blocks.reduce((a, b) => (b.load > a.load ? b : a));
  const recommendation =
    overtimeHours > 0
      ? `Add one extra attendant ${peak.label} instead of ${overtimeHours} h of overtime.`
      : greenChoice > 0
        ? `Schedule fits. ${greenChoice} guest${greenChoice === 1 ? '' : 's'} skipping cleaning freed ${Math.round((greenChoice * STAYOVER_MIN) / 6) / 10} h.`
        : 'Current schedule fits the forecast.';
  return {
    date: TOMORROW.date,
    departures: TOMORROW.departures,
    stayovers,
    greenChoice,
    arrivals: TOMORROW.arrivals,
    workloadHours,
    scheduled: TOMORROW.scheduled,
    attendantsNeeded,
    overtimeHours,
    recommendation,
    blocks,
  };
}

// ───────────────────────── Maintenance: recurring faults from messy records ─────────────────────────

interface Normalised {
  date: string;
  raw: string;
  asset: string;
  location: string;
  fault: string;
}

const ASSETS: { re: RegExp; asset: string }[] = [
  // Most specific first: "ice machine leaking" is an ice machine, not plumbing.
  { re: /\belev(ator)?[\s-]*b\b/i, asset: 'Elevator B' },
  { re: /\bice machine\b/i, asset: 'Ice machine' },
  { re: /\bdoor closer\b/i, asset: 'Door closer' },
  { re: /\b(ptac|a\/?c|hvac|heat|thermostat)\b/i, asset: 'Room heating/cooling' },
  { re: /\b(drain|shower|bathtub|toilet|leak)/i, asset: 'Plumbing' },
  { re: /\btv\b/i, asset: 'TV' },
];
const FAULTS: { re: RegExp; fault: string }[] = [
  { re: /not cold|no cooling|warm|fan only/i, fault: 'not cooling' },
  { re: /heat not working/i, fault: 'no heat' },
  { re: /door/i, fault: 'door fault' },
  { re: /drain/i, fault: 'slow drain' },
  { re: /leak/i, fault: 'leak' },
  { re: /signal/i, fault: 'no signal' },
];

/** Turns one free-text row into a structured record (asset · location · fault). */
export function normaliseRow(row: { date: string; raw: string }): Normalised {
  const asset = ASSETS.find((a) => a.re.test(row.raw))?.asset ?? 'Other';
  const fault = FAULTS.find((f) => f.re.test(row.raw))?.fault ?? 'other';
  const room = row.raw.match(/\b([3-6]\d{2})\b/)?.[1];
  const floor = row.raw.match(/\bfl(?:oor)?\.?\s*(\d)\b/i)?.[1];
  const location = asset === 'Elevator B' ? 'Elevator B' : room ? `Room ${room}` : floor ? `Floor ${floor}` : 'Public area';
  return { ...row, asset, location, fault };
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/** Groups normalised rows by asset + location + fault and flags repeats inside the window. */
export function findRecurringFaults(rows: { date: string; raw: string }[], asOf: string, windowDays = 60): MaintenanceInsight[] {
  const groups = new Map<string, Normalised[]>();
  for (const n of rows.map(normaliseRow)) {
    if (daysBetween(n.date, asOf) > windowDays) continue;
    const key = `${n.asset}|${n.location}|${n.fault}`;
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  const out: MaintenanceInsight[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const { asset, location, fault } = list[0];
    const high = list.length >= 3;
    out.push({
      asset,
      location,
      fault,
      occurrences: list.length,
      windowDays,
      severity: high ? 'high' : 'medium',
      recommendation: high
        ? `Plan a repair this week — an emergency call-out costs about 3× a planned one.`
        : 'Watch: one more report triggers a planned repair.',
      examples: list.map(({ date, raw }) => ({ date, raw })),
    });
  }
  return out.sort((a, b) => b.occurrences - a.occurrences);
}
