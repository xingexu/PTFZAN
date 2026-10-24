// Minute-by-minute simulation of the Oct 16 shift.
// The same physical events happen in both modes; only coordination differs:
//   baseline  = today's process (manual reassignment, phone calls, no shared ETA)
//   readypath = predicted ETAs, instant re-planning, supervisor approval, guest notifications
import type {
  Attendant, Guest, GuestNotification, GuestView, LogEntry, MaintenanceTicket, Metrics, Mode, NotificationKind,
  PlanProposal, Room, RoomStatus, SimState,
} from '../../shared/types.js';
import { fmtRange, fmtTime } from '../../shared/types.js';
import { diffPlans, knownAvailableAt, needBy, needsWork, planQueues, predictEtas } from './model.js';
import {
  buildSeed, ELEVATOR_PENALTY, GROUP, INSPECTION_MIN, SIM_END, SIM_START, STAYOVER_MIN, TIME as t, TRUE_BASE,
} from './seed.js';

type Scheduled = { at: number; run: () => void };

const DESK_AGENTS = 2;
const CHECKIN_MIN: Record<Mode, number> = { baseline: 6, readypath: 3 };

export class Simulation {
  state!: SimState;
  /** Called for every guest notification so real SMS can be sent outside the engine. */
  onNotify?: (n: GuestNotification, g: Guest, smsText: string) => void;
  private condition: Record<string, number> = {};
  private scheduled: Scheduled[] = [];
  private seq = 0;
  private lastCallAt = -999;
  private demoGuests: Guest[] = [];

  constructor(mode: Mode = 'readypath') {
    this.reset(mode);
  }

  // ───────────────────────────────── setup ─────────────────────────────────
  reset(mode: Mode, keep?: Partial<Pick<SimState, 'speed' | 'autoApprove'>>) {
    const seed = buildSeed();
    this.condition = seed.condition;
    this.scheduled = [];
    this.seq = 0;
    this.lastCallAt = -999;

    const attendants = seed.attendants;
    // The 08:00 assignment sheet (same in both modes): one floor each, rooms in number order.
    const byFloor = (floor: number) => seed.rooms.filter((r) => r.floor === floor && needsWork(r)).map((r) => r.id);
    attendants.forEach((a, i) => (a.queue = byFloor(3 + i)));

    const guests = [...seed.guests];
    for (const d of this.demoGuests) {
      guests.push({ ...d, state: 'informed-away', lastEtaSent: undefined, checkedInAt: undefined, returnAt: undefined, lobbyMinutes: 0, arrivalTime: SIM_START, arrivedAt: SIM_START });
    }

    this.state = {
      mode,
      now: SIM_START,
      start: SIM_START,
      end: SIM_END,
      playing: false,
      speed: keep?.speed ?? 5,
      autoApprove: keep?.autoApprove ?? false,
      elevatorDown: false,
      groupConfirmed: false,
      rooms: seed.rooms,
      attendants,
      guests,
      notifications: [],
      tickets: [],
      proposals: [],
      log: [],
      events: seed.events,
      nextEventIndex: 0,
      metrics: this.emptyMetrics(),
      frontDeskSnapshotAt: SIM_START,
      frontDeskSnapshot: {},
      deskAgents: Array.from({ length: DESK_AGENTS }, (_, i) => ({ id: `D${i + 1}`, busyUntil: 0, task: 'Available' })),
      finished: false,
    };
    this.refreshSnapshot();
    this.log('Duty manager', `Shift starts. ${mode === 'readypath' ? 'ReadyPath is live: one shared readiness view for every department.' : 'Assignments issued on paper; departments coordinate by phone.'}`, 'neutral');
    this.updateEtas();
    this.computeMetrics();
  }

  private emptyMetrics(): Metrics {
    return {
      lobbyWaiting: 0, lobbyPeak: 0, informedAway: 0, checkedIn: 0, groupRoomsReadyBy1500: 0, groupRoomsTotal: 20,
      groupRoomsNotReady: 20, avgWaitMin: 0, longestWaitMin: 0, readinessCalls: 0, notificationsSent: 0,
      etaAccuracyPct: null, etaScored: 0, wastedVisits: 0,
    };
  }

  // ───────────────────────────────── helpers ─────────────────────────────────
  private get rp() {
    return this.state.mode === 'readypath';
  }
  room(id: string) {
    return this.state.rooms.find((r) => r.id === id);
  }
  private att(id: string) {
    return this.state.attendants.find((a) => a.id === id)!;
  }
  private id(prefix: string) {
    return `${prefix}-${++this.seq}`;
  }
  private log(dept: LogEntry['dept'], text: string, tone: LogEntry['tone'] = 'neutral') {
    this.state.log.unshift({ at: this.state.now, dept, text, tone });
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
    // 5. ReadyPath routine re-plan every 30 minutes
    if (this.rp && now > SIM_START && now % 30 === 0) this.routineReplan();
    this.updateEtas();
    if (this.rp && now % 5 === 0) this.sendEtaNotifications();
    // 6. Guests & front desk
    this.advanceGuests();
    this.computeMetrics();

    if (this.pendingProposal) {
      s.playing = false;
      s.pausedReason = 'Supervisor approval needed';
    }
    if (now >= SIM_END) {
      s.finished = true;
      s.playing = false;
      this.log('Duty manager', this.endSummary(), this.rp ? 'good' : 'bad');
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
        this.att('A3').activity = 'Absent (sick call)';
        this.log('Housekeeping', 'Attendant 3 calls in sick after assignments are issued. Floor 5 is uncovered.', 'warn');
        if (this.rp) {
          this.propose('Attendant 3 absent', 'Redistribute floor 5 across the four attendants on shift.', false);
          this.log('ReadyPath', 'Re-planned in seconds. Front desk ETAs refreshed automatically.', 'ai');
        } else {
          this.schedule(t(8, 50), () => {
            const orphan = this.att('A3').queue;
            this.att('A3').queue = [];
            const present = s.attendants.filter((a) => a.present);
            orphan.forEach((rid, i) => present[i % present.length].queue.push(rid));
            this.log('Housekeeping', 'Rooms reassigned manually. No revised readiness forecast sent to the front desk.', 'warn');
          });
        }
        break;
      }
      case 'late': {
        for (const rid of ['505', '509', '606']) this.room(rid)!.lateReported = true;
        if (this.rp) {
          this.log('Front desk', 'Late checkouts entered in PMS: 505 (12:40), 509 (13:00), 606 (12:15).', 'neutral');
          this.propose('Late checkouts', 'Push late-checkout rooms behind rooms that are vacant now.', false);
        } else {
          this.log('Front desk', 'Late checkouts recorded. Updates reach housekeepers individually; some reach occupied rooms and change route.', 'warn');
        }
        break;
      }
      case 'elevator': {
        s.elevatorDown = true;
        const ticket: MaintenanceTicket = {
          id: 'MT-1042', asset: 'Elevator B', issue: 'Door fault — out of service', openedAt: s.now, status: 'open',
          owner: 'Maintenance · on-call technician', impact: `Carts share Elevator A; +${ELEVATOR_PENALTY} min per room on floors 5–6`,
        };
        s.tickets.push(ticket);
        this.log('Maintenance', 'Elevator B taken out of service. Fault assessment begins. Carts and guests share the remaining elevator.', 'bad');
        if (this.rp) {
          this.propose('Elevator B outage', 'Batch floors 5–6 to reduce cart trips; widen ETAs for affected rooms.', false);
          this.log('ReadyPath', 'Maintenance ticket MT-1042 linked to 20 rooms on floors 5–6. ETAs updated for the front desk.', 'ai');
        }
        break;
      }
      case 'group': {
        s.groupConfirmed = true;
        if (this.rp) {
          this.log('Front desk', 'Wedding group confirms arrivals around 3:00 PM (was after 5:00 PM).', 'warn');
          this.propose('Wedding arrives 3:00 PM', 'Move remaining wedding rooms ahead of later arrivals and stayovers.', true);
        } else {
          this.log('Front desk', 'The wedding group confirms arrivals around 15:00. Front desk requests room-priority changes after cleaning has started.', 'warn');
          s.metrics.readinessCalls += 3;
          this.schedule(t(14, 0), () => {
            // Supervisor finally redistributes the remaining block rooms by phone.
            const present = s.attendants.filter((a) => a.present);
            const block = s.rooms.filter((r) => r.groupBlock && needsWork(r)).map((r) => r.id);
            for (const a of s.attendants) a.queue = a.queue.filter((q) => !block.includes(q));
            block.forEach((rid, i) => present[i % present.length].queue.unshift(rid));
            this.log('Housekeeping', `Supervisor redistributes ${block.length} wedding rooms by phone (45 min after the request).`, 'warn');
          });
        }
        break;
      }
      case 'arrivals':
        this.log('Front desk', 'Wedding guests begin arriving.', 'neutral');
        break;
      case 'checkpoint': {
        const m = this.computeMetrics();
        if (this.rp) {
          this.log('Duty manager', `3:45 PM: ${m.lobbyWaiting} guests in the lobby, ${m.informedAway} informed and away, ${m.groupRoomsNotReady} wedding rooms still in progress — every guest has an ETA.`, 'good');
        } else {
          this.log('Duty manager', `3:45 PM: ${m.lobbyWaiting} guests waiting. ${m.groupRoomsNotReady} wedding rooms still being prepared. Reliable readiness estimates unavailable. Escalated.`, 'bad');
        }
        break;
      }
    }
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
        r.workEndsAt = now + INSPECTION_MIN;
      }
    } else if (r.status === 'inspection' && r.workEndsAt !== undefined && now >= r.workEndsAt) {
      r.status = 'ready';
      r.readyAt = now;
      r.serviceKind = undefined;
      r.eta = undefined;
      this.onRoomReady(r);
    }
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

    if (this.rp) {
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
      a.wastedVisits++;
      a.busyUntil = now + (r.floor !== a.lastFloor ? 8 : 5);
      a.lastFloor = r.floor;
      a.activity = `Knocked on ${r.id} — guest still in, route changed`;
      return;
    }
    a.activity = a.queue.length ? 'Waiting for checkouts' : 'List complete';
  }

  private startRoom(a: Attendant, r: Room) {
    const now = this.state.now;
    const stay = r.status === 'stayover';
    const travelMin = r.floor === a.lastFloor ? 1 : 4;
    const elev = this.state.elevatorDown && r.floor >= 5 ? ELEVATOR_PENALTY : 0;
    const base = stay ? STAYOVER_MIN : TRUE_BASE[r.type];
    const dur = Math.round(base * this.condition[r.id]) + travelMin + elev;
    r.status = 'cleaning';
    r.serviceKind = stay ? 'stayover' : 'full';
    r.cleaningBy = a.id;
    r.workStartedAt = now;
    r.workEndsAt = now + dur;
    a.currentRoom = r.id;
    a.busyUntil = now + dur;
    a.lastFloor = r.floor;
    a.queue = a.queue.filter((q) => q !== r.id);
    a.activity = `${stay ? 'Servicing' : 'Cleaning'} ${r.id}`;
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
    const label = groupOnly ? 'Wedding rooms predicted ready by 3:00 PM' : 'Arrival rooms predicted ready on time';
    const p: PlanProposal = {
      id: this.id('PLAN'),
      createdAt: s.now,
      trigger,
      summary,
      changes,
      queues,
      requiresApproval,
      status: 'pending',
      impact: `${label}: ${before.ok}/${before.total} → ${after.ok}/${after.total}`,
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
      this.log('Housekeeping', `Supervisor approved "${p.trigger}" plan — ${p.changes.length} rooms re-sequenced. Attendants' phones updated.`, 'good');
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
    this.log('Housekeeping', `Supervisor kept the current plan (dismissed "${p.trigger}").`, 'neutral');
    return true;
  }

  private routineReplan() {
    const p = this.propose('Routine refresh', 'Rolling 30-minute re-plan using the latest room status.', false);
    if (p && p.changes.length >= 3) this.log('ReadyPath', `Routine re-plan: ${p.changes.length} rooms re-sequenced (auto-applied, low impact).`, 'ai');
  }

  private updateEtas() {
    const s = this.state;
    if (!this.rp) {
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
    if (g.state === 'checked-in') return false;
    if (g.isDemoGuest) return true;
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
    if (!this.rp) return;
    for (const g of s.guests.filter((x) => x.roomId === r.id && x.state !== 'checked-in')) {
      const first = g.name.split(' ')[0];
      if (!g.lastEtaSent && !g.isDemoGuest && !this.shouldInform(g)) continue;
      this.notify(g, 'ready', `Room ${r.id} is ready`, `${first}, your room ${r.id} is ready! Skip the line with your mobile key or visit the express desk.`,
        `FHN Toronto: ${first}, your room ${r.id} is ready! Skip the line with your mobile key or the express desk.`);
      if (g.state === 'informed-away') g.returnAt = s.now + 8;
    }
  }

  private advanceGuests() {
    const s = this.state;
    const now = s.now;
    for (const g of s.guests) {
      if (g.isDemoGuest) {
        if (g.state === 'informed-away' && this.room(g.roomId)?.status === 'ready' && g.returnAt !== undefined && now >= g.returnAt) {
          g.state = 'checked-in';
          g.checkedInAt = now;
        }
        continue;
      }
      if (g.state === 'expected' && now >= g.arrivalTime) {
        g.arrivedAt = now;
        const r = this.room(g.roomId)!;
        if (this.rp) {
          if (r.status === 'ready' && g.consentSms && g.lastEtaSent) {
            g.state = 'checked-in'; // mobile key — room was ready, guest was told
            g.checkedInAt = now;
          } else if (r.status !== 'ready' && g.consentSms && g.lastEtaSent && r.eta && r.eta.high - now > 10) {
            g.state = 'informed-away';
            this.log('Guest', `${g.name.split(' ')[0]} (${g.roomId}) arrives, leaves bags at the bell desk instead of queueing — ETA ${fmtRange(r.eta.low, r.eta.high)}.`, 'ai');
          } else g.state = 'waiting';
        } else {
          g.state = 'waiting';
          if (r.status === 'ooo') g.heldUntil = now + 10;
        }
      }
      if (g.state === 'informed-away' && g.returnAt !== undefined && now >= g.returnAt && this.room(g.roomId)?.status === 'ready') {
        g.state = 'checked-in';
        g.checkedInAt = now;
      }
      if (g.state === 'waiting') g.lobbyMinutes++;
    }

    // Front desk agents
    for (const d of s.deskAgents) {
      if (now < d.busyUntil) continue;
      d.task = 'Available';
      const waiting = s.guests.filter((g) => g.state === 'waiting').sort((a, b) => (a.arrivedAt ?? 0) - (b.arrivedAt ?? 0));
      if (!this.rp && waiting.length && now >= t(14, 30) && now - this.lastCallAt >= 15) {
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
        return this.rp ? r.status === 'ready' : s.frontDeskSnapshot[r.id] === 'ready' && r.status === 'ready';
      };
      const next = waiting.find(visibleReady);
      if (next) {
        const dur = CHECKIN_MIN[s.mode];
        d.busyUntil = now + dur;
        d.task = `Checking in ${next.name.split(' ')[0]} · ${next.roomId}`;
        next.state = 'checked-in';
        next.checkedInAt = now + dur;
      }
    }
    // Baseline: the housekeeping office reports status to the desk roughly hourly before the rush.
    if (!this.rp && now % 60 === 0 && now < t(14, 30)) this.refreshSnapshot();
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

  // ───────────────────────────────── interactive actions ─────────────────────────────────
  reportIssue(roomId: string, issue: string): { ok: boolean; message: string } {
    const s = this.state;
    const r = this.room(roomId);
    if (!r) return { ok: false, message: 'Unknown room' };
    if (r.status === 'ooo') return { ok: false, message: `Room ${roomId} is already out of order` };

    const ticket: MaintenanceTicket = {
      id: `MT-${1043 + s.tickets.length}`, roomId, asset: issue.split(' ')[0] ?? 'Room', issue, openedAt: s.now,
      status: 'open', owner: 'Maintenance · on-call technician', impact: `Room ${roomId} out of order`,
    };
    s.tickets.push(ticket);
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
    this.log('Maintenance', `Ticket ${ticket.id}: ${issue} in room ${roomId}. Owner: on-call technician.`, 'warn');

    const affected = s.guests.filter((g) => g.roomId === r.id && !(g.state === 'checked-in' && wasStatus !== 'ready' && wasStatus !== 'occupied'));
    if (!affected.length) {
      if (this.rp) this.propose(`Room ${roomId} out of order`, 'Remove the room from today’s plan.', false);
      return { ok: true, message: `Ticket ${ticket.id} opened; no guest affected.` };
    }

    if (!this.rp) {
      this.log('Front desk', `Guest for ${roomId} not yet told. They will find out at the desk${affected[0].state === 'checked-in' ? ' when they call again' : ''}.`, 'bad');
      return { ok: true, message: `Ticket ${ticket.id} opened. Without ReadyPath, the guest is not informed.` };
    }

    // ReadyPath: swap the guest(s) into the best available room and tell them who owns the issue.
    const assigned = new Set(s.guests.filter((g) => g.state !== 'checked-in' || true).map((g) => g.roomId));
    const free = s.rooms.filter((x) => x.id !== r.id && !assigned.has(x.id) && !x.arrivalId && x.status !== 'ooo' && x.status !== 'occupied' && x.status !== 'stayover');
    const etas = predictEtas(s);
    const score = (x: Room) => (x.status === 'ready' ? 0 : (etas.get(x.id)?.high ?? 9999)) + (x.type === r.type ? 0 : 20);
    const pick = free.sort((x, y) => score(x) - score(y))[0];
    if (!pick) {
      this.propose(`Room ${roomId} out of order`, 'Remove the room from today’s plan.', false);
      return { ok: true, message: `Ticket ${ticket.id} opened. No free room available — duty manager alerted.` };
    }
    pick.arrivalId = r.arrivalId;
    pick.groupBlock = r.groupBlock;
    r.arrivalId = undefined;
    for (const g of affected) {
      g.roomId = pick.id;
      g.lastEtaSent = undefined;
    }
    this.propose(`Room ${roomId} out of order`, `Move guest to ${pick.id} and prioritise it.`, false);
    this.updateEtas();
    for (const g of affected) {
      const first = g.name.split(' ')[0];
      if (pick.status === 'ready') {
        this.notify(g, 'room-change', `Moved to room ${pick.id}`, `${first}, we found an issue with your original room (${issue.toLowerCase()}). Ticket ${ticket.id} is with our maintenance team. Your new room ${pick.id} is ready now.`,
          `FHN Toronto: ${first}, we moved you to room ${pick.id} because of a maintenance issue (ticket ${ticket.id}). Your new room is ready now.`);
        g.lastEtaSent = { low: s.now, high: s.now };
      } else {
        const e = pick.eta;
        this.notify(g, 'room-change', `Moved to room ${pick.id}`, `${first}, we found an issue with your original room (${issue.toLowerCase()}). Ticket ${ticket.id} is with maintenance. Your new room ${pick.id} is expected ${e ? fmtRange(e.low, e.high) : 'shortly'}.`,
          `FHN Toronto: ${first}, we moved you to room ${pick.id} because of a maintenance issue (ticket ${ticket.id}). Expected ready ${e ? fmtRange(e.low, e.high) : 'shortly'}.`);
        if (e) g.lastEtaSent = { low: e.low, high: e.high };
      }
    }
    this.log('ReadyPath', `Guest moved from ${roomId} to ${pick.id} (${pick.type}). Notified with ticket owner and new ETA.`, 'ai');
    return { ok: true, message: `Ticket ${ticket.id} opened. Guest moved to ${pick.id} and notified.` };
  }

  addDemoGuest(name: string, opts: { phoneMasked?: string; code?: string } = {}): Guest {
    const s = this.state;
    const etas = predictEtas(s);
    const candidates = s.rooms
      .filter((r) => r.groupBlock && r.status !== 'ready' && r.status !== 'ooo')
      .sort((a, b) => (etas.get(a.id)?.high ?? 9999) - (etas.get(b.id)?.high ?? 9999));
    const target = candidates[Math.floor(candidates.length / 3)] ?? s.rooms.find((r) => r.groupBlock)!;
    const code = opts.code ?? Simulation.newDemoCode((c) => s.guests.some((x) => x.code === c));
    const g: Guest = {
      code, name: name.trim().slice(0, 30) || 'Guest', partySize: 1, roomId: target.id, group: GROUP,
      arrivalTime: s.now, expectedArrival: s.now, arrivedAt: s.now, state: 'informed-away', consentSms: !!opts.phoneMasked,
      phoneMasked: opts.phoneMasked ?? 'Browser notifications', notifyBrowser: true, isDemoGuest: true, lobbyMinutes: 0,
    };
    if (target.status === 'ready') g.returnAt = s.now;
    this.demoGuests.push(g);
    s.guests.push(g);
    if (this.rp) {
      this.updateEtas();
      if (target.status === 'ready')
        this.notify(g, 'ready', `Room ${target.id} is ready`, `${g.name}, your room ${target.id} is ready! Use your mobile key.`, `FHN Toronto: ${g.name}, your room ${target.id} is ready! Use your mobile key.`);
      else this.sendEtaNotifications();
    }
    this.log('Guest', `${g.name} joined the demo as a wedding guest (room ${target.id}).`, 'neutral');
    return g;
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
    const real = s.guests.filter((g) => !g.isDemoGuest);
    const persons = (f: (g: Guest) => boolean) => real.filter(f).reduce((n, g) => n + g.partySize, 0);
    const block = s.rooms.filter((r) => r.groupBlock);
    const arrived = real.filter((g) => g.arrivedAt !== undefined);
    const waits = arrived.map((g) => g.lobbyMinutes);
    const scored = s.rooms.filter((r) => r.promisedBy !== undefined && r.readyAt !== undefined);
    const lobby = persons((g) => g.state === 'waiting');
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
      wastedVisits: s.attendants.reduce((n, a) => n + a.wastedVisits, 0),
    };
    s.metrics = m;
    return m;
  }

  private endSummary() {
    const m = this.state.metrics;
    return `5:00 PM summary — peak lobby ${m.lobbyPeak} guests, average lobby wait ${m.avgWaitMin} min, ${m.groupRoomsReadyBy1500}/${m.groupRoomsTotal} wedding rooms ready by 3:00 PM, ${m.readinessCalls} readiness calls${m.etaAccuracyPct !== null ? `, ${m.etaAccuracyPct}% of ETA promises kept` : ''}.`;
  }

  // ───────────────────────────────── views ─────────────────────────────────
  /** Privacy-scoped view for a single guest's portal — no other guests' data leaves the server. */
  guestView(code: string): GuestView | null {
    const s = this.state;
    const g = s.guests.find((x) => x.code.toUpperCase() === code.toUpperCase());
    if (!g) return null;
    const r = this.room(g.roomId)!;
    const ticket = r.maintenanceTicket ? s.tickets.find((x) => x.id === r.maintenanceTicket) : undefined;
    return {
      mode: s.mode,
      now: s.now,
      hotel: 'FHN Toronto Downtown',
      guest: { code: g.code, name: g.name, partySize: g.partySize, group: g.group, state: g.state, consentSms: g.consentSms, notifyBrowser: g.notifyBrowser, phoneMasked: g.phoneMasked, isDemoGuest: !!g.isDemoGuest },
      room: {
        id: r.status === 'ready' || s.mode === 'readypath' ? r.id : null,
        type: r.type,
        status: r.status,
        eta: s.mode === 'readypath' ? r.eta ?? null : null,
        readyAt: r.readyAt ?? null,
        floor: r.floor,
      },
      elevatorNotice: s.elevatorDown && r.floor >= 5 ? 'Elevator B is temporarily out of service; Elevator A serves all floors.' : null,
      ticket: ticket ? { id: ticket.id, owner: ticket.owner, issue: ticket.issue } : null,
      notifications: s.notifications.filter((n) => n.guestCode === g.code),
      delivery: {},
    };
  }

  setGuestPrefs(code: string, notifyBrowser: boolean) {
    const g = this.state.guests.find((x) => x.code.toUpperCase() === code.toUpperCase());
    if (!g) return false;
    g.notifyBrowser = notifyBrowser;
    const d = this.demoGuests.find((x) => x.code === g.code);
    if (d) d.notifyBrowser = notifyBrowser;
    return true;
  }
}
