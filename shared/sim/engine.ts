// Minute-by-minute simulation of the Oct 16 shift.
// The same physical events happen in both modes; only coordination differs:
//   baseline = today's process (manual reassignment, phone calls, no shared ETA)
//   ai       = FHN AI: predicted ETAs, instant re-planning, supervisor approval, guest notifications,
//              one-report maintenance tickets and occupancy-aware room climate
import type {
  Attendant, Guest, GuestNotification, GuestRequest, GuestView, HousekeepingPref, LogEntry, MaintenanceTicket, Metrics, Mode,
  NotificationKind, PlanProposal, Room, RoomStatus, SimState,
} from '../types.js';
import { fmtRange, fmtTime } from '../types.js';
import { walkMin } from './layout.js';
import { diffPlans, findRecurringFaults, forecastStaffing, knownAvailableAt, needBy, needsWork, planQueues, predictedDuration, predictEtas } from './model.js';
import {
  buildSeed, ELEVATOR_PENALTY, GROUP, HISTORY_AS_OF, IN_HOUSE_CODE, INSPECTION_MIN, KW_ECO, KW_RUNNING, MAINTENANCE_HISTORY, SIM_END,
  SIM_START, STAYOVER_MIN, TIME as t, TRUE_BASE,
} from './seed.js';

type Scheduled = { at: number; run: () => void };

const DESK_AGENTS = 2;
const CHECKIN_MIN: Record<Mode, number> = { baseline: 6, ai: 3 };
/** Arrival rooms are brought back to comfort this long before a guest can walk in. */
const PRECONDITION_MIN = 20;
/** Lower-case for mid-sentence use, but keep acronyms: "Plumbing leak" → "plumbing leak", "AC not cooling" stays. */
const midSentence = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const CHECKIN_WINDOW = t(14, 30);
/** Today's process: minutes between the supervisor's inspection rounds. */
const INSPECTION_ROUND = 120;

interface DayStats {
  ecoMin: number;
  pulledStaffMin: number;
  repeatReports: number;
  acReportedAt: number | null;
  acFixMin: number | null;
  preconditioned: number;
}

export class Simulation {
  state!: SimState;
  /** Called for every guest notification so real SMS can be sent outside the engine. */
  onNotify?: (n: GuestNotification, g: Guest, smsText: string) => void;
  private condition: Record<string, number> = {};
  private scheduled: Scheduled[] = [];
  private seq = 0;
  private lastCallAt = -999;
  private demoGuests: Guest[] = [];
  private stats!: DayStats;
  /** Today's process: the wedding block is handed to the desk only after escalation (Exhibit 4, 15:45). */
  private groupReleased = false;
  /** Today's process: readiness calls from 14:30 (Exhibit 4). */
  private callsStarted = false;

  constructor(mode: Mode = 'ai') {
    this.reset(mode);
  }

  // ───────────────────────────────── setup ─────────────────────────────────
  reset(mode: Mode, keep?: Partial<Pick<SimState, 'speed' | 'autoApprove'>>) {
    const seed = buildSeed();
    this.condition = seed.condition;
    this.scheduled = [];
    this.seq = 0;
    this.lastCallAt = -999;
    this.stats = { ecoMin: 0, pulledStaffMin: 0, repeatReports: 0, acReportedAt: null, acFixMin: null, preconditioned: 0 };
    this.groupReleased = false;
    this.callsStarted = false;

    const attendants = seed.attendants;
    // The 08:00 assignment sheet (same in both modes): one floor each, rooms in number order.
    attendants.filter((a) => !a.onCall).forEach((a, i) => (a.queue = seed.rooms.filter((r) => r.floor === 3 + i && needsWork(r)).map((r) => r.id)));
    // Not in the Exhibit 4 log: an in-house guest's AC fails mid-afternoon (the maintenance demo).
    this.schedule(t(14, 5), () => this.acFault());

    const guests = [...seed.guests];
    for (const d of this.demoGuests) {
      const state = d.onlineCheckIn ? 'informed-away' : 'expected';
      guests.push({ ...d, state, lastEtaSent: undefined, checkedInAt: undefined, returnAt: undefined, awayUntil: undefined, lobbyMinutes: 0, arrivalTime: SIM_START, arrivedAt: SIM_START });
    }

    this.state = {
      mode,
      now: SIM_START,
      start: SIM_START,
      end: SIM_END,
      playing: false,
      speed: keep?.speed ?? 10,
      autoApprove: keep?.autoApprove ?? false,
      autopilot: false,
      elevatorDown: false,
      groupConfirmed: false,
      rooms: seed.rooms,
      attendants,
      guests,
      notifications: [],
      tickets: [],
      requests: [],
      proposals: [],
      log: [],
      events: seed.events,
      nextEventIndex: 0,
      metrics: this.emptyMetrics(),
      staffing: forecastStaffing(guests),
      insights: findRecurringFaults(MAINTENANCE_HISTORY, HISTORY_AS_OF),
      frontDeskSnapshotAt: SIM_START,
      frontDeskSnapshot: {},
      deskAgents: Array.from({ length: DESK_AGENTS }, (_, i) => ({ id: `D${i + 1}`, busyUntil: 0, task: 'Available' })),
      finished: false,
    };
    this.refreshSnapshot();
    this.log('Duty manager', `Shift starts. ${mode === 'ai' ? 'FHN AI is on: everyone sees the same live picture of rooms, staff, repairs and room temperature.' : 'Assignments issued on paper; departments coordinate by phone.'}`, 'neutral');
    this.updateEtas();
    this.updateClimate(false);
    this.computeMetrics();
  }

  private emptyMetrics(): Metrics {
    return {
      lobbyWaiting: 0, lobbyPeak: 0, informedAway: 0, checkedIn: 0, groupRoomsReadyBy1500: 0, groupRoomsTotal: 20,
      groupRoomsNotReady: 20, avgWaitMin: 0, longestWaitMin: 0, readinessCalls: 0, notificationsSent: 0,
      etaAccuracyPct: null, etaScored: 0, groupWaiting: 0, groupAway: 0, groupIn: 0, groupExpected: 40,
      wastedVisits: 0, attendantMinLost: 0, pulledStaffMin: 0, ticketsOpen: 0, repeatReports: 0, acFixMin: null,
      ecoRoomHours: 0, kwhSaved: 0, vacantRunning: 0, preconditioned: 0,
    };
  }

  // ───────────────────────────────── helpers ─────────────────────────────────
  private get ai() {
    return this.state.mode === 'ai';
  }
  room(id: string) {
    return this.state.rooms.find((r) => r.id === id);
  }
  private att(id: string) {
    return this.state.attendants.find((a) => a.id === id)!;
  }
  private guest(code: string) {
    return this.state.guests.find((x) => x.code.toUpperCase() === code.toUpperCase());
  }
  private id(prefix: string) {
    return `${prefix}-${++this.seq}`;
  }
  private log(dept: LogEntry['dept'], text: string, tone: LogEntry['tone'] = 'neutral', fromApp = false) {
    this.state.log.unshift({ at: this.state.now, dept, text, tone, ...(fromApp ? { fromApp } : {}) });
    if (this.state.log.length > 200) this.state.log.pop();
  }
  private schedule(at: number, run: () => void) {
    this.scheduled.push({ at, run });
  }
  private refreshSnapshot() {
    const snap: Record<string, RoomStatus> = {};
    for (const r of this.state.rooms) snap[r.id] = r.status;
    this.state.frontDeskSnapshot = snap;
    this.state.frontDeskSnapshotAt = this.state.now;
  }
  private nextTicketId() {
    return `#${1042 + this.state.tickets.length}`;
  }
  get pendingProposal() {
    return this.state.proposals.find((p) => p.status === 'pending');
  }

  // ───────────────────────────────── main loop ─────────────────────────────────
  /** Advance one simulated minute. Returns false if blocked (pending approval or finished). */
  tick(): boolean {
    const s = this.state;
    if (s.finished || this.pendingProposal) return false;
    const now = s.now;

    // 1. Scenario events
    while (s.nextEventIndex < s.events.length && s.events[s.nextEventIndex].at <= now) {
      this.handleEvent(s.events[s.nextEventIndex].id);
      s.nextEventIndex++;
    }
    if (this.pendingProposal) {
      // Stop on this minute so the supervisor decides before anything else moves.
      s.playing = false;
      s.pausedReason = 'Supervisor approval needed';
      this.updateEtas();
      this.computeMetrics();
      return false;
    }
    // 2. Manual (baseline) or delayed actions
    const due = this.scheduled.filter((x) => x.at <= now);
    this.scheduled = this.scheduled.filter((x) => x.at > now);
    due.forEach((x) => x.run());

    // 3. Room state changes
    for (const r of s.rooms) this.advanceRoom(r);
    // 4. Attendants work
    for (const a of s.attendants) this.advanceAttendant(a);
    for (const a of s.attendants.filter((x) => x.helper && x.present)) {
      if (a.currentRoom || a.queue.length || now < a.busyUntil) this.stats.pulledStaffMin++;
      else {
        a.present = false;
        a.activity = 'Back to their own job';
      }
    }
    // 5. Routine re-plan every 30 minutes
    if (this.ai && now > SIM_START && now % 30 === 0) this.routineReplan();
    this.updateEtas();
    if (this.ai && now % 5 === 0) this.sendEtaNotifications();
    // 6. Guests & front desk
    this.advanceGuests();
    // 7. Room climate follows who is (about to be) in each room
    this.updateClimate(true);
    this.computeMetrics();

    if (this.pendingProposal) {
      s.playing = false;
      s.pausedReason = 'Supervisor approval needed';
    }
    if (now >= SIM_END) {
      s.finished = true;
      s.playing = false;
      s.autopilot = false;
      this.log('Duty manager', this.endSummary(), this.ai ? 'good' : 'bad');
      return false;
    }
    s.now = now + 1;
    return true;
  }

  /** Run until the next scenario event has been processed (or we get blocked). */
  nextEvent() {
    const s = this.state;
    const target = s.events[s.nextEventIndex]?.at ?? SIM_END;
    while (s.now <= target && this.tick()) {
      /* advance */
    }
  }

  step(minutes: number) {
    for (let i = 0; i < minutes; i++) if (!this.tick()) break;
  }

  // ───────────────────────────────── events ─────────────────────────────────
  private handleEvent(id: string) {
    const s = this.state;
    switch (id) {
      case 'absence': {
        this.att('A3').present = false;
        this.att('A3').activity = 'Off sick';
        if (this.ai) {
          this.log('Housekeeping', 'Employee absence reported after assignments are issued (Attendant 3).', 'warn');
          this.propose('Attendant 3 off sick', 'Share Attendant 3’s rooms among the attendants on shift.', false);
          const short = this.shortfallHours();
          this.log('FHN AI', `New plan in seconds. With three attendants, about ${short} hours of rooms would still be unfinished at 5 PM — so the backup attendant is booked for 8:45 (supervisor confirmed).`, 'ai');
          this.schedule(t(8, 45), () => {
            const oc = s.attendants.find((a) => a.onCall)!;
            oc.present = true;
            oc.busyUntil = s.now + 5;
            oc.lastFloor = 5;
            oc.activity = 'Starting shift';
            this.propose('Backup attendant arrives', 'Give the backup attendant the floor 5–6 rooms that free up first.', false);
            this.log('Housekeeping', 'Backup attendant starts — booked at 8:00 because the forecast showed the gap.', 'good');
          });
        } else {
          // Manual: the orphaned rooms are tacked onto the end of everyone else's paper list.
          const orphan = this.att('A3').queue;
          this.att('A3').queue = [];
          const present = s.attendants.filter((a) => a.present);
          orphan.forEach((rid, i) => present[i % present.length].queue.push(rid));
          this.log('Housekeeping', 'Employee absence reported after assignments are issued. Rooms reassigned manually. No revised readiness forecast sent to the front desk.', 'warn');
        }
        break;
      }
      case 'late': {
        for (const rid of ['505', '509', '606']) this.room(rid)!.lateReported = true;
        if (this.ai) {
          this.log('Front desk', 'Late checkouts entered in the booking system: 505 (12:40), 509 (1:00), 606 (12:15).', 'neutral');
          this.propose('Late checkouts', 'Clean the rooms that are empty now first; late-checkout rooms later.', false);
        } else {
          this.log('Front desk', 'Late checkouts recorded. Updates reach housekeepers individually; some staff reach occupied rooms and change their route.', 'warn');
        }
        break;
      }
      case 'elevator': {
        s.elevatorDown = true;
        const ticket: MaintenanceTicket = {
          id: this.nextTicketId(), asset: 'Elevator B', issue: 'Door fault — out of service', openedAt: s.now, status: 'open',
          owner: 'Elevator contractor', impact: `Carts share Elevator A; +${ELEVATOR_PENALTY} min per room on floors 5–6`,
        };
        s.tickets.push(ticket);
        this.log('Maintenance', 'Elevator taken out of service (Elevator B). Fault assessment begins. Carts and guests share the remaining elevator.', 'bad');
        if (this.ai) {
          this.propose('Elevator B out', 'Group floor 5–6 rooms to save elevator trips; give those rooms wider ready times.', false);
          this.log('FHN AI', `Repair ${ticket.id} linked to the 20 rooms on floors 5–6; their ready times updated for the front desk. This elevator door had already failed 3 times in 60 days.`, 'ai');
        }
        break;
      }
      case 'group': {
        s.groupConfirmed = true;
        if (this.ai) {
          this.log('Front desk', 'Wedding group confirms arrivals around 3:00 PM (was after 5:00 PM).', 'warn');
          this.propose('Wedding arrives 3:00 PM', 'Clean the remaining wedding rooms before later arrivals and staying guests.', true);
        } else {
          this.log('Front desk', 'The wedding group confirms arrivals around 15:00. Front desk requests room-priority changes after cleaning has started.', 'warn');
          s.metrics.readinessCalls += 3;
          this.schedule(t(14, 0), () => {
            // Supervisor finally redistributes the remaining block rooms by phone.
            const present = s.attendants.filter((a) => a.present);
            const block = s.rooms.filter((r) => r.groupBlock && needsWork(r)).map((r) => r.id);
            for (const a of s.attendants) a.queue = a.queue.filter((q) => !block.includes(q));
            block.forEach((rid, i) => present[i % present.length].queue.unshift(rid));
            // …and tells everyone to do tonight's other arrival rooms before stayovers.
            const arrivalFirst = (id: string) => (this.room(id)!.groupBlock ? 0 : this.room(id)!.arrivalId ? 1 : 2);
            for (const a of present) a.queue.sort((x, y) => arrivalFirst(x) - arrivalFirst(y));
            this.log('Housekeeping', `Supervisor reshuffles ${block.length} wedding rooms by phone, 45 minutes after the request.`, 'warn');
          });
        }
        break;
      }
      case 'calls': {
        const block = s.rooms.filter((r) => r.groupBlock);
        if (this.ai) {
          this.log('FHN AI', `No calls needed: the front desk sees ${block.filter((r) => r.status === 'ready').length} wedding rooms ready and an expected ready time for the other ${block.filter((r) => r.status !== 'ready').length}.`, 'ai');
        } else {
          this.callsStarted = true;
          this.log('Front desk', 'Calls made for readiness updates. Estimates remain informal; no shared view of unfinished work or repair status.', 'warn');
        }
        break;
      }
      case 'arrivals':
        if (this.ai) this.log('Front desk', 'Wedding guests begin arriving. Guests whose rooms are ready go straight up with a mobile key; the rest already have a ready time.', 'good');
        else this.log('Front desk', 'Wedding guests begin arriving. Some assigned rooms are not ready; staff handles check-ins while calling for updates.', 'warn');
        break;
      case 'checkpoint': {
        const m = this.computeMetrics();
        if (this.ai) {
          this.log('Duty manager', `3:45 PM: ${m.groupWaiting} wedding guests waiting, ${m.groupIn} in their rooms, ${m.groupAway} out with a ready time. ${m.groupRoomsNotReady} rooms still in progress — every guest has an answer. Nothing to escalate.`, 'good');
        } else {
          this.log('Duty manager', `${m.groupWaiting} guests waiting. ${m.groupRoomsNotReady} rooms are still being prepared. The elevator remains out of service. Reliable readiness estimates unavailable. Escalated.`, 'bad');
          // The duty manager needs a couple of minutes to pull people together.
          this.schedule(s.now + 2, () => this.escalate());
        }
        break;
      }
      case 'release': {
        const m = this.computeMetrics();
        const cleared = m.groupRoomsNotReady === 0 && m.lobbyWaiting === 0;
        if (this.ai) this.log('Duty manager', `5:00 PM: every room ready and every arriving guest in their room. Elevator B repair still open with the contractor.`, 'good');
        else
          this.log(
            'Duty manager',
            cleared
              ? 'Remaining group rooms released after cleaning and inspection. Check-in queue clears. The elevator issue remains under management.'
              : `${m.groupRoomsNotReady} group rooms still not released; ${m.lobbyWaiting} guests still waiting. The elevator issue remains under management.`,
            cleared ? 'warn' : 'bad',
          );
        break;
      }
    }
  }

  /** Hours of predicted room work beyond what the attendants on shift can do by 5 PM. */
  private shortfallHours() {
    const s = this.state;
    const work = s.rooms.filter(needsWork).reduce((n, r) => n + predictedDuration(r) + INSPECTION_MIN + 3, 0);
    const shift = SIM_END - (SIM_START + 30) - 30; // after briefing, minus break
    const capacity = s.attendants.filter((a) => a.present).length * shift;
    return Math.max(0, Math.round(((work - capacity) / 60) * 10) / 10);
  }

  /**
   * Today's process at 15:45: the duty manager takes over. The supervisor and a houseperson are pulled off
   * their own jobs to finish the wedding rooms, and rooms go to the desk one by one after inspection.
   */
  private escalate() {
    const s = this.state;
    this.groupReleased = true;
    this.refreshSnapshot();
    const helpers: Attendant[] = [
      ['H1', 'Supervisor (pulled in)'],
      ['H2', 'Houseperson (pulled in)'],
      ['H3', 'Evening attendant (called in early)'],
    ].map(([id, label]) => ({
      id, label, present: true, queue: [], busyUntil: s.now + 5, lastFloor: 5, activity: 'Pulled in by the duty manager',
      breakAt: SIM_END, hadBreak: true, wastedVisits: 0, wastedMin: 0, helper: true,
    }));
    s.attendants.push(...helpers);
    // Finished rooms waiting for the supervisor's round are inspected now.
    s.rooms.filter((r) => r.status === 'inspection').forEach((r, i) => (r.workEndsAt = Math.min(r.workEndsAt ?? s.now, s.now + INSPECTION_MIN + i * 2)));
    // Everything left is re-dealt in the order guests need it: wedding, today's other arrivals, evening suites, the rest.
    const left = s.rooms
      .filter((r) => needsWork(r) && r.status !== 'ooo')
      .sort((a, b) => needBy(a, s) - needBy(b, s) || knownAvailableAt(a, s.now) - knownAvailableAt(b, s.now));
    for (const a of s.attendants) a.queue = [];
    // Each room goes to whoever frees up first.
    const crew = s.attendants.filter((a) => a.present).map((a) => ({ a, free: Math.max(s.now + 5, a.busyUntil) }));
    for (const r of left) {
      const c = crew.reduce((x, y) => (y.free < x.free ? y : x));
      c.a.queue.push(r.id);
      c.free = Math.max(c.free, knownAvailableAt(r, s.now)) + predictedDuration(r) + 4 + (s.elevatorDown && r.floor >= 5 ? ELEVATOR_PENALTY : 0);
    }
    // The duty manager also opens a third check-in station.
    s.deskAgents.push({ id: 'DM', busyUntil: s.now + 2, task: 'Duty manager on the desk' });
    const wedding = left.filter((r) => r.groupBlock).length;
    this.log('Duty manager', `Supervisor and houseperson pulled off their own work and the evening attendant called in early to finish ${wedding} wedding rooms and ${left.length - wedding} others. Duty manager opens a third check-in station; rooms go to the desk one by one after their final check.`, 'warn');
  }

  /** 14:05 — the in-house guest in 411 reports that the AC has stopped cooling. */
  private acFault() {
    const g = this.guest(IN_HOUSE_CODE);
    if (!g) return;
    this.stats.acReportedAt = this.state.now;
    if (this.ai) {
      this.log('Guest', `${g.name.split(' ')[0]} (411) reports “AC not cooling” in the FHN app.`, 'neutral');
      this.openIssue(g, 'AC not cooling');
      return;
    }
    // Today: phone calls, paper notes, and a technician tied up with the elevator.
    const req = this.addRequest(g, 'issue', 'AC not cooling', null, null);
    const desk = this.state.deskAgents.find((d) => this.state.now >= d.busyUntil) ?? this.state.deskAgents[0];
    desk.busyUntil = this.state.now + 4;
    desk.task = 'Taking an AC complaint · 411';
    this.log('Front desk', 'Guest in 411 calls: AC not cooling. Noted on paper — maintenance is busy with Elevator B.', 'warn');
    this.schedule(t(14, 45), () => {
      req.reports++;
      this.stats.repeatReports++;
      this.log('Guest', 'Guest in 411 calls again and explains the AC problem to a different employee. No reference number, no time given.', 'bad');
    });
    this.schedule(t(15, 10), () => {
      const ticket = this.openTicket('411', 'Room heating/cooling', 'AC not cooling', 'Maintenance technician', 'Guest in room; comfort complaint');
      req.ticketId = ticket.id;
      req.owner = 'Maintenance technician';
      req.status = 'on-the-way';
      this.log('Maintenance', `Technician dispatched to 411 after the elevator (${ticket.id}).`, 'warn');
    });
    this.schedule(t(15, 45), () => this.resolveRequest(req, false));
  }

  // ───────────────────────────────── rooms & attendants ─────────────────────────────────
  private advanceRoom(r: Room) {
    const now = this.state.now;
    if (r.status === 'occupied' && r.actualCheckout !== undefined && now >= r.actualCheckout) {
      r.status = 'dirty';
    } else if (r.status === 'cleaning' && r.workEndsAt !== undefined && now >= r.workEndsAt) {
      const a = this.state.attendants.find((x) => x.currentRoom === r.id);
      if (a) {
        a.currentRoom = undefined;
        a.activity = 'Finished ' + r.id;
      }
      r.cleaningBy = undefined;
      if (r.serviceKind === 'stayover') {
        r.status = 'stayover';
        r.serviced = true;
        r.serviceKind = undefined;
      } else {
        r.status = 'inspection';
        r.workEndsAt = this.inspectionDoneAt(r, now);
      }
    } else if (r.status === 'inspection' && r.workEndsAt !== undefined && now >= r.workEndsAt) {
      r.status = 'ready';
      r.readyAt = now;
      r.serviceKind = undefined;
      r.eta = undefined;
      this.onRoomReady(r);
    }
  }

  /**
   * FHN AI: the attendant's "done" tap sends the supervisor straight to the room.
   * Today: the supervisor can't see which rooms are finished, so inspection waits for the next round of the
   * floors — every two hours on a day spent covering an absence, an elevator outage and priority changes —
   * until the duty manager takes over at escalation.
   */
  private inspectionDoneAt(r: Room, now: number) {
    if (this.ai || this.groupReleased) return now + INSPECTION_MIN;
    const round = Math.ceil((now + 1) / INSPECTION_ROUND) * INSPECTION_ROUND;
    return round + INSPECTION_MIN + (r.floor - 3) * 4;
  }

  private serviceable(r: Room) {
    const now = this.state.now;
    return r.status === 'dirty' || (r.status === 'stayover' && !r.serviced && now >= (r.guestOutAt ?? 0));
  }

  private advanceAttendant(a: Attendant) {
    const s = this.state;
    const now = s.now;
    if (!a.present || now < a.busyUntil) return;
    if (a.currentRoom && this.room(a.currentRoom)?.status !== 'cleaning') a.currentRoom = undefined;
    if (a.currentRoom) return;
    if (!a.hadBreak && now >= a.breakAt) {
      a.hadBreak = true;
      a.busyUntil = now + 30;
      a.activity = 'Break';
      return;
    }
    a.queue = a.queue.filter((id) => {
      const r = this.room(id);
      return !!r && needsWork(r) && r.status !== 'ooo';
    });

    if (this.ai) {
      const id = a.queue.find((q) => this.serviceable(this.room(q)!));
      if (id) return this.startRoom(a, this.room(id)!);
      const next = a.queue[0] ? this.room(a.queue[0]) : undefined;
      a.activity = next ? `Waiting — ${next.id} frees ~${fmtTime(knownAvailableAt(next, now))}` : 'Queue complete — available to help';
      return;
    }

    // Baseline: work the paper list in order; discover occupied rooms by knocking.
    for (let i = 0; i < a.queue.length; i++) {
      const r = this.room(a.queue[i])!;
      if (this.serviceable(r)) return this.startRoom(a, r);
      if (r.knockedAt !== undefined && now - r.knockedAt < 40) continue; // remembers recent knocks
      r.knockedAt = now;
      a.queue.splice(i, 1);
      a.queue.push(r.id);
      const lost = r.floor !== a.lastFloor ? 8 : 5;
      a.wastedVisits++;
      a.wastedMin += lost;
      a.busyUntil = now + lost;
      a.lastFloor = r.floor;
      a.lastRoom = r.id;
      a.activity = `Knocked on ${r.id} — guest still in, route changed`;
      return;
    }
    a.activity = a.queue.length ? 'Waiting for checkouts' : 'List complete';
  }

  private startRoom(a: Attendant, r: Room) {
    const now = this.state.now;
    const stay = r.status === 'stayover';
    const travelMin = walkMin(a.lastRoom ?? a.lastFloor, r.id);
    const elev = this.state.elevatorDown && r.floor >= 5 ? ELEVATOR_PENALTY : 0;
    const base = stay ? STAYOVER_MIN : TRUE_BASE[r.type];
    const dur = Math.round(base * this.condition[r.id] + travelMin) + elev;
    r.status = 'cleaning';
    r.serviceKind = stay ? 'stayover' : 'full';
    r.cleaningBy = a.id;
    r.workStartedAt = now;
    r.travelMin = Math.round(travelMin) + elev;
    r.workEndsAt = now + dur;
    a.currentRoom = r.id;
    a.busyUntil = now + dur;
    a.lastFloor = r.floor;
    a.lastRoom = r.id;
    a.queue = a.queue.filter((q) => q !== r.id);
    a.activity = `${stay ? 'Tidying' : 'Cleaning'} ${r.id}`;
  }

  // ───────────────────────────────── room climate (energy) ─────────────────────────────────
  /**
   * Today a vacant room keeps heating or cooling at the last guest's setting. FHN AI sets vacant rooms
   * back to eco and brings them to comfort shortly before someone is predicted to walk in — using the
   * same readiness forecast and the guest's own "heading back" signal. Never while a guest is inside.
   */
  private updateClimate(account: boolean) {
    const s = this.state;
    const now = s.now;
    const byRoom = new Map<string, Guest[]>();
    for (const g of s.guests) byRoom.set(g.roomId, [...(byRoom.get(g.roomId) ?? []), g]);

    for (const r of s.rooms) {
      const gs = byRoom.get(r.id) ?? [];
      const inside = gs.find((g) => g.state === 'checked-in' && now >= (g.checkedInAt ?? 0) && (!g.inHouse || now >= g.arrivalTime));
      const occupied = r.status === 'occupied' || (r.status === 'stayover' && now < (r.guestOutAt ?? 0));
      if (inside || occupied) {
        const away = inside?.awayUntil;
        if (this.ai && away !== undefined && now < away) r.hvac = now >= away - PRECONDITION_MIN ? 'precool' : 'eco';
        else r.hvac = 'comfort';
        continue;
      }
      if (!this.ai) {
        r.hvac = 'running';
        continue;
      }
      // In-house guest out for the day who told the app when they'd be back.
      const returning = gs.find((g) => g.inHouse && now < g.arrivalTime);
      if (returning) {
        r.hvac = returning.arrivalTime - now <= PRECONDITION_MIN ? 'precool' : 'eco';
        continue;
      }
      const arriving = gs.filter((g) => g.state !== 'checked-in' && !g.inHouse && (!g.isDemoGuest || g.onlineCheckIn));
      const soon = r.status === 'ready' || r.status === 'inspection' || (!!r.eta && r.eta.low - now <= PRECONDITION_MIN);
      const coming = arriving.some((g) => g.state === 'informed-away' || g.state === 'waiting' || now >= CHECKIN_WINDOW);
      r.hvac = soon && coming && r.status !== 'ooo' ? 'precool' : 'eco';
    }
    if (account) this.stats.ecoMin += s.rooms.filter((r) => r.hvac === 'eco').length;
  }

  // ───────────────────────────────── planning ─────────────────────────────────
  propose(trigger: string, summary: string, requiresApproval: boolean): PlanProposal | undefined {
    const s = this.state;
    const queues = planQueues(s);
    const changes = diffPlans(s, queues, trigger);
    if (!changes.length && !requiresApproval) return undefined;

    // Impact = rooms predicted ready before their guests need them (wedding rooms by 3:00 PM once confirmed).
    const groupOnly = s.groupConfirmed;
    const onTime = (q?: Record<string, string[]>) => {
      const etas = predictEtas(s, q);
      let ok = 0;
      let total = 0;
      for (const r of s.rooms) {
        const g = s.guests.find((x) => x.roomId === r.id && !x.isDemoGuest && x.state !== 'checked-in');
        if (!g || (groupOnly && !r.groupBlock)) continue;
        total++;
        if (r.status === 'ready') ok++;
        else {
          const e = etas.get(r.id);
          const due = groupOnly ? t(15, 0) : Math.max(t(15, 0), needBy(r, s));
          if (e && (e.low + e.high) / 2 <= due) ok++;
        }
      }
      return { ok, total };
    };
    const before = onTime();
    const after = onTime(queues);
    const label = groupOnly ? 'Wedding rooms ready by 3 PM (forecast)' : 'Arriving guests’ rooms ready on time (forecast)';
    const p: PlanProposal = {
      id: this.id('PLAN'),
      createdAt: s.now,
      trigger,
      summary,
      changes,
      queues,
      requiresApproval,
      status: 'pending',
      impact: `${label}: ${before.ok} → ${after.ok} of ${after.total}`,
    };
    s.proposals.unshift(p);
    if (s.proposals.length > 30) s.proposals.pop();
    if (!requiresApproval || s.autoApprove) this.applyProposal(p, requiresApproval ? 'approved' : 'auto-applied');
    return p;
  }

  private applyProposal(p: PlanProposal, status: PlanProposal['status']) {
    for (const a of this.state.attendants) a.queue = a.present ? [...(p.queues[a.id] ?? [])] : [];
    p.status = status;
    this.updateEtas();
    if (status === 'approved') {
      this.log('Housekeeping', `Supervisor approved the new plan (“${p.trigger}”) — ${p.changes.length} rooms in a new order; attendants’ phones updated.`, 'good');
      this.sendEtaNotifications();
    }
  }

  approve(id: string) {
    const p = this.state.proposals.find((x) => x.id === id && x.status === 'pending');
    if (!p) return false;
    // Re-plan at approval time so the queues reflect the current minute.
    p.queues = planQueues(this.state);
    this.applyProposal(p, 'approved');
    this.state.pausedReason = undefined;
    this.computeMetrics();
    return true;
  }

  dismiss(id: string) {
    const p = this.state.proposals.find((x) => x.id === id && x.status === 'pending');
    if (!p) return false;
    p.status = 'dismissed';
    this.state.pausedReason = undefined;
    this.log('Housekeeping', `Supervisor kept the current plan (“${p.trigger}”).`, 'neutral');
    return true;
  }

  private routineReplan() {
    const p = this.propose('Regular update', 'Every 30 minutes the plan is refreshed with the latest room status.', false);
    if (p && p.changes.length >= 3) this.log('FHN AI', `Regular update: cleaning order adjusted for ${p.changes.length} rooms (done automatically, small change).`, 'ai');
  }

  private updateEtas() {
    const s = this.state;
    if (!this.ai) {
      for (const r of s.rooms) r.eta = undefined;
      return;
    }
    const etas = predictEtas(s);
    for (const r of s.rooms) r.eta = r.status === 'ready' ? undefined : etas.get(r.id);
  }

  // ───────────────────────────────── guests ─────────────────────────────────
  private notify(g: Guest, kind: NotificationKind, title: string, body: string, sms?: string) {
    const channel: GuestNotification['channel'] | null = g.consentSms ? 'sms' : g.notifyBrowser || g.isDemoGuest ? 'push' : null;
    if (!channel) return;
    const n: GuestNotification = { id: this.id('N'), guestCode: g.code, at: this.state.now, kind, channel, title, body };
    this.state.notifications.unshift(n);
    if (this.state.notifications.length > 400) this.state.notifications.pop();
    this.state.metrics.notificationsSent++;
    // Real delivery (SMS) happens outside the engine; only demo guests who opted in have a real number.
    this.onNotify?.(n, g, sms ?? `FHN Toronto: ${body}`);
  }

  private shouldInform(g: Guest) {
    const s = this.state;
    if (g.state === 'checked-in' || g.inHouse) return false;
    if (g.isDemoGuest) return !!g.onlineCheckIn;
    if (g.group) return s.groupConfirmed && !this.pendingProposal;
    return s.now >= g.expectedArrival - 90;
  }

  private sendEtaNotifications() {
    const s = this.state;
    for (const g of s.guests) {
      if (!this.shouldInform(g)) continue;
      const r = this.room(g.roomId);
      if (!r || r.status === 'ready' || !r.eta) continue;
      const { low, high } = r.eta;
      const first = g.name.split(' ')[0];
      if (!g.lastEtaSent) {
        this.notify(g, 'eta', 'Your room is being prepared',
          `Hi ${first}, welcome to FHN Toronto. Your room is expected ready ${fmtRange(low, high)}. We'll message you the moment it's ready — bags can wait at the bell desk.`,
          `FHN Toronto: Hi ${first}, your room is being prepared - expected ready ${fmtRange(low, high)}. We'll text you the second it's ready.`);
        g.lastEtaSent = { low, high };
        if (r.promisedBy === undefined) r.promisedBy = high;
      } else if (Math.abs(high - g.lastEtaSent.high) >= 15) {
        this.notify(g, 'eta-update', 'Updated room estimate', `Quick update: your room is now expected ${fmtRange(low, high)}. Sorry for the change — we'll message you when it's ready.`,
          `FHN Toronto: Update - your room is now expected ${fmtRange(low, high)}. We'll text you the second it's ready.`);
        g.lastEtaSent = { low, high };
      }
    }
  }

  private onRoomReady(r: Room) {
    const s = this.state;
    if (!this.ai) return;
    for (const g of s.guests.filter((x) => x.roomId === r.id && x.state !== 'checked-in')) {
      const first = g.name.split(' ')[0];
      if (g.isDemoGuest ? !g.onlineCheckIn : !g.lastEtaSent && !this.shouldInform(g)) continue;
      this.notify(g, 'ready', `Room ${r.id} is ready`, `${first}, your room ${r.id} is ready! Skip the line with your mobile key or visit the express desk.`,
        `FHN Toronto: ${first}, your room ${r.id} is ready! Skip the line with your mobile key or the express desk.`);
      if (g.state === 'informed-away') g.returnAt = s.now + 8;
    }
  }

  private checkIn(g: Guest, at: number) {
    g.state = 'checked-in';
    g.checkedInAt = at;
    const r = this.room(g.roomId);
    if (this.ai && r && (r.hvac === 'precool' || r.hvac === 'comfort') && !g.inHouse) this.stats.preconditioned++;
  }

  private advanceGuests() {
    const s = this.state;
    const now = s.now;
    for (const g of s.guests) {
      if (g.inHouse) continue;
      if (g.isDemoGuest) {
        if (g.state === 'informed-away' && this.room(g.roomId)?.status === 'ready' && g.returnAt !== undefined && now >= g.returnAt) this.checkIn(g, now);
        continue;
      }
      if (g.state === 'expected' && now >= g.arrivalTime) {
        g.arrivedAt = now;
        const r = this.room(g.roomId)!;
        if (this.ai) {
          if (r.status === 'ready' && g.consentSms && g.lastEtaSent) {
            this.checkIn(g, now); // mobile key — room was ready, guest was told
          } else if (r.status !== 'ready' && g.consentSms && g.lastEtaSent && r.eta && r.eta.high - now > 10) {
            g.state = 'informed-away';
            this.log('Guest', `${g.name.split(' ')[0]} (${g.roomId}) arrives, leaves bags at the bell desk instead of queueing — ready ${fmtRange(r.eta.low, r.eta.high)}.`, 'ai');
          } else g.state = 'waiting';
        } else {
          g.state = 'waiting';
          if (r.status === 'ooo') g.heldUntil = now + 10;
        }
      }
      if (g.state === 'informed-away' && g.returnAt !== undefined && now >= g.returnAt && this.room(g.roomId)?.status === 'ready') this.checkIn(g, now);
      if (g.state === 'waiting') g.lobbyMinutes++;
    }

    // Front desk agents
    for (const d of s.deskAgents) {
      if (now < d.busyUntil) continue;
      d.task = 'Available';
      const waiting = s.guests.filter((g) => g.state === 'waiting').sort((a, b) => (a.arrivedAt ?? 0) - (b.arrivedAt ?? 0));
      if (!this.ai && this.callsStarted && !this.groupReleased && now - this.lastCallAt >= 15) {
        // "Calls made for readiness updates" — one agent leaves the counter to phone housekeeping.
        this.lastCallAt = now;
        d.busyUntil = now + 6;
        d.task = 'Calling housekeeping for room status';
        s.metrics.readinessCalls++;
        this.schedule(now + 6, () => this.refreshSnapshot());
        continue;
      }
      const visibleReady = (g: Guest) => {
        if (g.heldUntil && now < g.heldUntil) return false;
        const r = this.room(g.roomId)!;
        if (r.status === 'ooo') return this.rehouse(g);
        // A guest (not in a group block) who has waited 10 minutes is upgraded into a vacant, ready spare.
        if (!g.group && g.lobbyMinutes >= 10 && r.status !== 'ready' && this.rehouse(g)) {
          this.log('Front desk', `${g.name.split(' ')[0]} waited ${g.lobbyMinutes} min — moved from ${r.id} to ready room ${g.roomId}.`, 'warn');
          return true;
        }
        if (this.ai) return r.status === 'ready';
        // Today: the wedding block isn't handed to the desk until escalation; then the duty manager confirms on the floor.
        if (g.group && !this.groupReleased) return false;
        return this.groupReleased ? r.status === 'ready' : s.frontDeskSnapshot[r.id] === 'ready' && r.status === 'ready';
      };
      const next = waiting.find(visibleReady);
      if (next) {
        const dur = CHECKIN_MIN[s.mode];
        d.busyUntil = now + dur;
        d.task = `Checking in ${next.name.split(' ')[0]} · ${next.roomId}`;
        this.checkIn(next, now + dur);
      }
    }
    // Baseline: the housekeeping office reports status to the desk roughly hourly before the rush;
    // after escalation the duty manager walks the floors and reports every 10 minutes.
    if (!this.ai && now % 60 === 0 && now < t(14, 30)) this.refreshSnapshot();
    if (!this.ai && this.groupReleased && now % 10 === 0) this.refreshSnapshot();
  }

  /** Find a replacement room when the assigned one is out of order. Returns true if one is ready. */
  private rehouse(g: Guest): boolean {
    const s = this.state;
    const old = this.room(g.roomId)!;
    const taken = new Set(s.guests.filter((x) => x.state !== 'checked-in' || x.roomId).map((x) => x.roomId));
    const candidates = s.rooms.filter((r) => r.status === 'ready' && !taken.has(r.id) && !r.arrivalId);
    const pick = candidates.find((r) => r.type === old.type) ?? candidates[0];
    if (!pick) return false;
    for (const x of s.guests.filter((y) => y.roomId === old.id)) x.roomId = pick.id;
    pick.arrivalId = old.arrivalId;
    pick.groupBlock = old.groupBlock;
    old.arrivalId = undefined;
    return true;
  }

  // ───────────────────────────────── maintenance & requests ─────────────────────────────────
  private openTicket(roomId: string | undefined, asset: string, issue: string, owner: string, impact: string): MaintenanceTicket {
    const ticket: MaintenanceTicket = { id: this.nextTicketId(), roomId, asset, issue, openedAt: this.state.now, status: 'open', owner, impact };
    this.state.tickets.push(ticket);
    return ticket;
  }

  private addRequest(g: Guest, kind: GuestRequest['kind'], title: string, owner: string | null, etaAt: number | null): GuestRequest {
    const req: GuestRequest = {
      id: this.id('RQ'), guestCode: g.code, roomId: g.roomId, kind, title, openedAt: this.state.now, owner, etaAt,
      status: owner ? 'assigned' : 'received', reports: 1,
    };
    this.state.requests.unshift(req);
    if (this.state.requests.length > 200) this.state.requests.pop();
    return req;
  }

  private resolveRequest(req: GuestRequest, tell: boolean) {
    const s = this.state;
    req.status = 'resolved';
    req.resolvedAt = s.now;
    const ticket = req.ticketId ? s.tickets.find((x) => x.id === req.ticketId) : undefined;
    if (ticket) {
      ticket.status = 'resolved';
      ticket.resolvedAt = s.now;
    }
    if (req.roomId === '411' && req.kind === 'issue' && this.stats.acReportedAt !== null) this.stats.acFixMin = s.now - this.stats.acReportedAt;
    const g = this.guest(req.guestCode);
    if (req.kind === 'issue') this.log('Maintenance', `${req.title} in ${req.roomId} fixed${ticket ? ` (${ticket.id})` : ''}.`, tell ? 'good' : 'neutral');
    if (tell && g) {
      const first = g.name.split(' ')[0];
      if (req.kind === 'issue') this.notify(g, 'request', 'Fixed', `${first}, the ${midSentence(req.title)} issue in room ${req.roomId} is fixed${ticket ? ` (request ${ticket.id})` : ''}. Thanks for your patience.`);
      else this.notify(g, 'request', 'Delivered', `${first}, your ${midSentence(req.title)} ${req.title.endsWith('s') ? 'have' : 'has'} been delivered to room ${req.roomId}.`);
    }
  }

  /**
   * A guest reports a problem from their room. FHN AI opens one ticket, names the owner, promises a time
   * and keeps the guest updated — so nobody has to report the same thing twice.
   */
  private openIssue(g: Guest, issue: string): GuestRequest {
    const s = this.state;
    const r = this.room(g.roomId)!;
    if (!this.ai) {
      const req = this.addRequest(g, 'issue', issue, null, null);
      this.log('Front desk', `Room ${r.id} reports “${issue}”. Written on the maintenance sheet.`, 'warn');
      this.schedule(s.now + 90, () => this.resolveRequest(req, false));
      return req;
    }
    const travel = s.elevatorDown && r.floor >= 5 ? 26 : 20;
    const asset = /ac|heat|cool|warm|cold/i.test(issue) ? 'Room heating/cooling' : /leak|drain|toilet|shower|water/i.test(issue) ? 'Plumbing' : /tv/i.test(issue) ? 'TV' : 'Room';
    const ticket = this.openTicket(r.id, asset, issue, 'Maintenance technician', 'Guest in room');
    const req = this.addRequest(g, 'issue', issue, 'Maintenance technician', s.now + travel);
    req.ticketId = ticket.id;
    const first = g.name.split(' ')[0];
    this.notify(g, 'request', "We're on it", `${first}, request ${ticket.id} is open for “${midSentence(issue)}” in room ${r.id}. Our maintenance technician will be there by ${fmtTime(s.now + travel)}. We'll update you here — no need to call.`,
      `FHN Toronto: Request ${ticket.id} - our technician will be at room ${r.id} by ${fmtTime(s.now + travel)}. No need to call; we'll update you here.`);
    const flagged = s.insights.find((x) => x.location === `Room ${r.id}` && x.asset === asset);
    this.log(
      'FHN AI',
      `Repair ${ticket.id}: ${issue} in ${r.id} → technician there by ${fmtTime(s.now + travel)}; guest told who has it.${flagged ? ` This unit had already failed ${flagged.occurrences} times in ${flagged.windowDays} days — replacement scheduled.` : ''}`,
      'ai',
    );
    this.schedule(s.now + travel - 8, () => {
      if (req.status === 'assigned') req.status = 'on-the-way';
    });
    this.schedule(s.now + travel + 12, () => this.resolveRequest(req, true));
    return req;
  }

  // ───────────────────────────────── interactive actions ─────────────────────────────────
  reportIssue(roomId: string, issue: string): { ok: boolean; message: string } {
    const s = this.state;
    const r = this.room(roomId);
    if (!r) return { ok: false, message: 'Unknown room' };
    if (r.status === 'ooo') return { ok: false, message: `Room ${roomId} is already out of order` };

    const ticket = this.openTicket(roomId, issue.split(' ')[0] ?? 'Room', issue, 'Maintenance technician', `Room ${roomId} being repaired`);
    const a = s.attendants.find((x) => x.currentRoom === r.id);
    if (a) {
      a.currentRoom = undefined;
      a.busyUntil = s.now;
      a.activity = `Stopped ${r.id} — issue reported`;
    }
    const wasStatus = r.status;
    r.status = 'ooo';
    r.maintenanceTicket = ticket.id;
    r.eta = undefined;
    for (const x of s.attendants) x.queue = x.queue.filter((q) => q !== r.id);
    this.log('Maintenance', `Repair ${ticket.id}: ${issue} in room ${roomId}. Assigned to the maintenance technician.`, 'warn');

    const affected = s.guests.filter((g) => g.roomId === r.id && !g.inHouse && !(g.state === 'checked-in' && wasStatus !== 'ready' && wasStatus !== 'occupied'));
    if (!affected.length) {
      if (this.ai) this.propose(`Room ${roomId} being repaired`, 'Take the room out of today’s cleaning plan.', false);
      return { ok: true, message: `Ticket ${ticket.id} opened; no guest affected.` };
    }

    if (!this.ai) {
      this.log('Front desk', `Guest for ${roomId} not yet told. They will find out at the desk${affected[0].state === 'checked-in' ? ' when they call again' : ''}.`, 'bad');
      return { ok: true, message: `Ticket ${ticket.id} opened. With today's process, the guest is not informed.` };
    }

    // FHN AI: swap the guest(s) into the best available room and tell them who owns the issue.
    const assigned = new Set(s.guests.map((g) => g.roomId));
    const free = s.rooms.filter((x) => x.id !== r.id && !assigned.has(x.id) && !x.arrivalId && x.status !== 'ooo' && x.status !== 'occupied' && x.status !== 'stayover');
    const etas = predictEtas(s);
    const score = (x: Room) => (x.status === 'ready' ? 0 : (etas.get(x.id)?.high ?? 9999)) + (x.type === r.type ? 0 : 20);
    const pick = free.sort((x, y) => score(x) - score(y))[0];
    if (!pick) {
      this.propose(`Room ${roomId} being repaired`, 'Take the room out of today’s cleaning plan.', false);
      return { ok: true, message: `Ticket ${ticket.id} opened. No free room available — duty manager alerted.` };
    }
    pick.arrivalId = r.arrivalId;
    pick.groupBlock = r.groupBlock;
    r.arrivalId = undefined;
    for (const g of affected) {
      g.roomId = pick.id;
      g.lastEtaSent = undefined;
    }
    this.propose(`Room ${roomId} being repaired`, `Move the guest to ${pick.id} and clean it first.`, false);
    this.updateEtas();
    for (const g of affected) {
      const first = g.name.split(' ')[0];
      if (pick.status === 'ready') {
        this.notify(g, 'room-change', `Moved to room ${pick.id}`, `${first}, we found an issue with your original room (${midSentence(issue)}). Repair ${ticket.id} is with our maintenance team. Your new room ${pick.id} is ready now.`,
          `FHN Toronto: ${first}, we moved you to room ${pick.id} because of a maintenance issue (ticket ${ticket.id}). Your new room is ready now.`);
        g.lastEtaSent = { low: s.now, high: s.now };
      } else {
        const e = pick.eta;
        this.notify(g, 'room-change', `Moved to room ${pick.id}`, `${first}, we found an issue with your original room (${midSentence(issue)}). Repair ${ticket.id} is with maintenance. Your new room ${pick.id} is expected ${e ? fmtRange(e.low, e.high) : 'shortly'}.`,
          `FHN Toronto: ${first}, we moved you to room ${pick.id} because of a maintenance issue (ticket ${ticket.id}). Expected ready ${e ? fmtRange(e.low, e.high) : 'shortly'}.`);
        if (e) g.lastEtaSent = { low: e.low, high: e.high };
      }
    }
    this.log('FHN AI', `Guest moved from ${roomId} to ${pick.id} (${pick.type}) and told who is fixing it and the new ready time.`, 'ai');
    return { ok: true, message: `Ticket ${ticket.id} opened. Guest moved to ${pick.id} and notified.` };
  }

  /** Room for a new demo guest: a wedding room still in progress, about a third of the way down the ETA list. */
  private pickDemoRoom(): Room {
    const s = this.state;
    const etas = predictEtas(s);
    const candidates = s.rooms
      .filter((r) => r.groupBlock && r.status !== 'ready' && r.status !== 'ooo')
      .sort((a, b) => (etas.get(a.id)?.high ?? 9999) - (etas.get(b.id)?.high ?? 9999));
    return candidates[Math.floor(candidates.length / 3)] ?? s.rooms.find((r) => r.groupBlock)!;
  }

  /** Adds an audience member as a wedding guest. With checkIn=false they finish online check-in in the guest app. */
  addDemoGuest(name: string, opts: { phoneMasked?: string; code?: string; checkIn?: boolean } = {}): Guest {
    const s = this.state;
    const target = this.pickDemoRoom();
    const code = opts.code ?? Simulation.newDemoCode((c) => s.guests.some((x) => x.code === c));
    const checkIn = opts.checkIn ?? true;
    const g: Guest = {
      code, name: name.trim().slice(0, 30) || 'Guest', partySize: 1, roomId: target.id, group: GROUP,
      arrivalTime: s.now, expectedArrival: s.now, arrivedAt: s.now, state: checkIn ? 'informed-away' : 'expected', consentSms: !!opts.phoneMasked,
      phoneMasked: opts.phoneMasked ?? 'Browser notifications', notifyBrowser: true, isDemoGuest: true, onlineCheckIn: checkIn, lobbyMinutes: 0,
      housekeeping: 'standard', setpoint: 21,
    };
    this.demoGuests.push(g);
    s.guests.push(g);
    this.log('Guest', `${g.name} opened the guest app as a wedding guest${checkIn ? ` (room ${target.id})` : ''}.`, 'neutral', true);
    if (checkIn) this.afterOnlineCheckIn(g);
    return g;
  }

  private afterOnlineCheckIn(g: Guest) {
    const s = this.state;
    const target = this.room(g.roomId)!;
    if (target.status === 'ready') g.returnAt = s.now;
    if (!this.ai) return;
    this.updateEtas();
    if (target.status === 'ready')
      this.notify(g, 'ready', `Room ${target.id} is ready`, `${g.name}, your room ${target.id} is ready! Use your mobile key.`, `FHN Toronto: ${g.name}, your room ${target.id} is ready! Use your mobile key.`);
    else this.sendEtaNotifications();
  }

  /** "Check in online" from the guest app: assigns the room and immediately shares the predicted ready time. */
  checkInOnline(code: string): { ok: boolean; message: string } {
    const g = this.guest(code);
    if (!g) return { ok: false, message: 'Unknown booking' };
    if (!g.isDemoGuest) return { ok: false, message: 'This booking is part of the simulation.' };
    if (g.onlineCheckIn) return { ok: true, message: 'Already checked in.' };
    g.roomId = this.pickDemoRoom().id;
    g.onlineCheckIn = true;
    g.state = 'informed-away';
    const d = this.demoGuests.find((x) => x.code === g.code);
    if (d) Object.assign(d, { onlineCheckIn: true, roomId: g.roomId });
    this.log('Guest', `${g.name.split(' ')[0]} checked in online — room ${g.roomId}.`, 'neutral', true);
    this.afterOnlineCheckIn(g);
    this.updateClimate(false);
    return { ok: true, message: `Room ${g.roomId}` };
  }

  guestReportIssue(code: string, issue: string): { ok: boolean; message: string } {
    const g = this.guest(code);
    if (!g) return { ok: false, message: 'Unknown booking' };
    if (g.state !== 'checked-in') return { ok: false, message: 'You can report a problem once you are in your room.' };
    const open = this.state.requests.find((x) => x.guestCode === g.code && x.kind === 'issue' && x.status !== 'resolved' && x.title === issue);
    if (open) return { ok: true, message: `Already reported — ${open.owner ?? 'the front desk'} has it.` };
    this.log('Guest', `${g.name.split(' ')[0]} (room ${g.roomId}) reported “${issue}” in the guest app.`, 'neutral', true);
    const req = this.openIssue(g, issue);
    return { ok: true, message: req.ticketId ? `Request ${req.ticketId} · ${req.owner}` : 'Sent to the front desk' };
  }

  guestRequestItem(code: string, item: string): { ok: boolean; message: string } {
    const g = this.guest(code);
    if (!g) return { ok: false, message: 'Unknown booking' };
    if (g.state !== 'checked-in') return { ok: false, message: 'Requests open once you are in your room.' };
    const r = this.room(g.roomId)!;
    const eta = this.ai ? this.state.now + 15 : null;
    const req = this.addRequest(g, 'amenity', item, this.ai ? `Housekeeping · floor ${r.floor}` : null, eta);
    this.log('Guest', `${g.name.split(' ')[0]} (room ${g.roomId}) asked for ${midSentence(item)}.`, 'neutral', true);
    this.schedule(this.state.now + (this.ai ? 15 : 35), () => this.resolveRequest(req, this.ai));
    return { ok: true, message: eta ? `On the way by ${fmtTime(eta)}` : 'Request sent to the front desk' };
  }

  /** Guest climate: preferred temperature and "I'm out until…" / "I'm back" (drives eco and pre-conditioning). */
  guestClimate(code: string, input: { setpoint?: number; awayMinutes?: number | null }): { ok: boolean; message: string } {
    const g = this.guest(code);
    if (!g) return { ok: false, message: 'Unknown booking' };
    if (input.setpoint !== undefined) g.setpoint = Math.min(25, Math.max(18, Math.round(input.setpoint)));
    if (input.awayMinutes !== undefined) {
      if (input.awayMinutes === null) g.awayUntil = undefined;
      else g.awayUntil = this.state.now + Math.min(600, Math.max(15, input.awayMinutes));
      if (g.awayUntil) this.log('Guest', `${g.name.split(' ')[0]} (room ${g.roomId}) is out until about ${fmtTime(g.awayUntil)} — room on energy saver until then.`, 'neutral', true);
    }
    const d = this.demoGuests.find((x) => x.code === g.code);
    if (d) d.setpoint = g.setpoint;
    this.updateClimate(false);
    const r = this.room(g.roomId);
    return { ok: true, message: g.awayUntil ? `Eco while you're out · ${g.setpoint}°C by ${fmtTime(g.awayUntil)}` : `${g.setpoint}°C${r ? ` in room ${r.id}` : ''}` };
  }

  guestHousekeeping(code: string, pref: HousekeepingPref): { ok: boolean; message: string } {
    const g = this.guest(code);
    if (!g) return { ok: false, message: 'Unknown booking' };
    const before = this.state.staffing.workloadHours;
    g.housekeeping = pref;
    const d = this.demoGuests.find((x) => x.code === g.code);
    if (d) d.housekeeping = pref;
    this.state.staffing = forecastStaffing(this.state.guests);
    if (pref !== 'standard' && this.ai)
      this.log('Guest', `${g.name.split(' ')[0]} (room ${g.roomId}) ${pref === 'green' ? 'skips tomorrow’s cleaning' : 'turned on Do not disturb'} — tomorrow’s housekeeping work ${before} h → ${this.state.staffing.workloadHours} h.`, 'ai', true);
    return { ok: true, message: pref === 'green' ? 'Green choice saved — thank you!' : pref === 'dnd' ? 'Do not disturb is on' : 'Daily service is on' };
  }

  /** Short, unambiguous demo code (no 0/O/1/I). */
  static newDemoCode(taken: (c: string) => boolean): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (;;) {
      let c = 'DEMO';
      for (let i = 0; i < 4; i++) c += alphabet[Math.floor(Math.random() * alphabet.length)];
      if (!taken(c)) return c;
    }
  }

  // ───────────────────────────────── metrics ─────────────────────────────────
  computeMetrics(): Metrics {
    const s = this.state;
    const real = s.guests.filter((g) => !g.isDemoGuest && !g.inHouse);
    const persons = (f: (g: Guest) => boolean) => real.filter(f).reduce((n, g) => n + g.partySize, 0);
    const group = (f: (g: Guest) => boolean) => persons((g) => !!g.group && f(g));
    const block = s.rooms.filter((r) => r.groupBlock);
    const arrived = real.filter((g) => g.arrivedAt !== undefined);
    const waits = arrived.map((g) => g.lobbyMinutes);
    const scored = s.rooms.filter((r) => r.promisedBy !== undefined && r.readyAt !== undefined);
    const lobby = persons((g) => g.state === 'waiting');
    const ecoHours = this.stats.ecoMin / 60;
    const m: Metrics = {
      lobbyWaiting: lobby,
      lobbyPeak: Math.max(s.metrics.lobbyPeak, lobby),
      informedAway: persons((g) => g.state === 'informed-away'),
      checkedIn: persons((g) => g.state === 'checked-in'),
      groupRoomsTotal: block.length,
      groupRoomsReadyBy1500: block.filter((r) => r.readyAt !== undefined && r.readyAt <= t(15, 0)).length,
      groupRoomsNotReady: block.filter((r) => r.status !== 'ready').length,
      avgWaitMin: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : 0,
      longestWaitMin: waits.length ? Math.max(...waits) : 0,
      readinessCalls: s.metrics.readinessCalls,
      notificationsSent: s.metrics.notificationsSent,
      etaAccuracyPct: scored.length ? Math.round((100 * scored.filter((r) => r.readyAt! <= r.promisedBy!).length) / scored.length) : null,
      etaScored: scored.length,
      groupWaiting: group((g) => g.state === 'waiting'),
      groupAway: group((g) => g.state === 'informed-away'),
      groupIn: group((g) => g.state === 'checked-in'),
      groupExpected: group((g) => g.state === 'expected'),
      wastedVisits: s.attendants.reduce((n, a) => n + a.wastedVisits, 0),
      attendantMinLost: s.attendants.reduce((n, a) => n + a.wastedMin, 0),
      pulledStaffMin: this.stats.pulledStaffMin,
      ticketsOpen: s.tickets.filter((x) => x.status === 'open').length,
      repeatReports: this.stats.repeatReports,
      acFixMin: this.stats.acFixMin,
      ecoRoomHours: Math.round(ecoHours * 10) / 10,
      kwhSaved: Math.round(ecoHours * (KW_RUNNING - KW_ECO)),
      vacantRunning: s.rooms.filter((r) => r.hvac === 'running').length,
      preconditioned: this.stats.preconditioned,
    };
    s.metrics = m;
    return m;
  }

  private endSummary() {
    const m = this.state.metrics;
    const energy = this.ai ? `, ${m.kwhSaved} kWh saved in empty rooms` : '';
    return `5:00 PM summary — at most ${m.lobbyPeak} guests waiting at once, average wait ${m.avgWaitMin} min, ${m.groupRoomsReadyBy1500} of ${m.groupRoomsTotal} wedding rooms ready by 3 PM, ${m.readinessCalls} phone calls to check on rooms${m.etaAccuracyPct !== null ? `, ${m.etaAccuracyPct}% of ready-time promises kept` : ''}${energy}.`;
  }


  // ───────────────────────────────── views ─────────────────────────────────
  /** Privacy-scoped view for a single guest's app — no other guests' data leaves the server. */
  guestView(code: string): GuestView | null {
    const s = this.state;
    const g = this.guest(code);
    if (!g) return null;
    const r = this.room(g.roomId)!;
    const ticket = r.maintenanceTicket ? s.tickets.find((x) => x.id === r.maintenanceTicket) : undefined;
    const checkedInOnline = g.isDemoGuest ? !!g.onlineCheckIn : !!g.inHouse || !!g.lastEtaSent || g.state !== 'expected';
    const showRoom = checkedInOnline && (this.ai || r.status === 'ready' || g.state === 'checked-in');
    const nights = g.inHouse ? 3 : g.group ? 2 : 1;
    return {
      mode: s.mode,
      now: s.now,
      hotel: 'FHN Toronto Downtown',
      stay: {
        arrive: g.inHouse ? 'Wed, Oct 14' : 'Fri, Oct 16',
        depart: g.inHouse ? 'Sat, Oct 17' : g.group ? 'Sun, Oct 18' : 'Sat, Oct 17',
        nights,
        confirmation: `${(g.group ? 'WD' : g.inHouse ? 'IH' : 'RS')}${String(7300 + [...g.code].reduce((n, c) => n + c.charCodeAt(0), 0)).slice(-4)}-${g.code.slice(-3)}`,
      },
      guest: {
        code: g.code, name: g.name, partySize: g.partySize, group: g.group, state: g.state, consentSms: g.consentSms, notifyBrowser: g.notifyBrowser,
        phoneMasked: g.phoneMasked, isDemoGuest: !!g.isDemoGuest, checkedInOnline, canCheckIn: !!g.isDemoGuest && !g.onlineCheckIn,
        inRoom: g.state === 'checked-in' && (!g.inHouse || s.now >= g.arrivalTime), housekeeping: g.housekeeping,
      },
      room: {
        id: showRoom ? r.id : null,
        type: r.type,
        status: r.status,
        eta: this.ai && checkedInOnline ? r.eta ?? null : null,
        readyAt: r.readyAt ?? null,
        floor: r.floor,
      },
      climate: { hvac: r.hvac, setpoint: g.setpoint, awayUntil: g.awayUntil ?? null },
      elevatorNotice: s.elevatorDown && r.floor >= 5 ? 'Elevator B is temporarily out of service; Elevator A serves all floors.' : null,
      ticket: ticket ? { id: ticket.id, owner: ticket.owner, issue: ticket.issue } : null,
      requests: s.requests.filter((x) => x.guestCode === g.code),
      notifications: s.notifications.filter((n) => n.guestCode === g.code),
      delivery: {},
    };
  }

  setGuestPrefs(code: string, notifyBrowser: boolean) {
    const g = this.guest(code);
    if (!g) return false;
    g.notifyBrowser = notifyBrowser;
    const d = this.demoGuests.find((x) => x.code === g.code);
    if (d) d.notifyBrowser = notifyBrowser;
    return true;
  }
}
