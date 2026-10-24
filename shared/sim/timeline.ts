// The hotel day as one shared timeline. The database holds a small control record (mode, play/pause, speed,
// the 30-second demo, and when the clock was last set) and an append-only log of decisions (plan approvals,
// problem reports). Because the simulation is deterministic, any screen — or the server — rebuilds exactly
// the same hotel from those two things at any moment, so every screen shows the same rooms at the same time.
import { DEMO_HOLD_MS, demoSpeedAt } from './demo.js';
import { Simulation } from './engine.js';
import { SIM_END, SIM_START } from './seed.js';
import type { Mode } from '../types.js';

export const SPEEDS = [5, 10, 20, 30, 60];

export interface Control {
  /** Increments every time the day starts again. Events belong to one run. */
  run: number;
  mode: Mode;
  /** The supervisor's auto-approve setting when this run started (later changes are events). */
  autoApproveAtStart: boolean;
  /** The current auto-approve setting. */
  autoApprove: boolean;
  playing: boolean;
  /** Simulated minutes per real second (manual playback). */
  speed: number;
  /** The 30-second demo is driving the clock. */
  autopilot: boolean;
  /** How far a stopped demo got: plans that came up before this minute were approved, as the demo does. */
  autoApproveUntil: number;
  /** The clock: at server time `anchorMs` the day was at minute `anchorMinute`. */
  anchorMinute: number;
  anchorMs: number;
  version: number;
}

export type EventKind = 'approve' | 'dismiss' | 'issue' | 'auto-approve';
export interface TimelineEvent {
  id: number;
  run: number;
  /** The minute of the day it happened (the simulation's `now` when it was made). */
  minute: number;
  kind: EventKind;
  data: Record<string, unknown>;
}

export const initialControl = (nowMs = 0): Control => ({
  run: 1, mode: 'ai', autoApproveAtStart: false, autoApprove: false, playing: false, speed: 10, autopilot: false,
  autoApproveUntil: 0, anchorMinute: SIM_START, anchorMs: nowMs, version: 1,
});

export class ActionError extends Error {}

const clampMinute = (m: unknown) => {
  const n = Math.round(Number(m));
  if (!Number.isFinite(n)) throw new ActionError('Missing minute');
  return Math.min(SIM_END + 1, Math.max(SIM_START, n));
};

/**
 * One control change, as the server (or an offline screen) applies it. `minute` is where the screen that made
 * the change was in the day. Returns the new control and, for decisions, the event to append.
 */
export function applyAction(
  cur: Control,
  action: string,
  body: Record<string, unknown>,
  nowMs: number,
): { control: Control; event?: Omit<TimelineEvent, 'id'> } {
  const next: Control = { ...cur, version: cur.version + 1 };
  // Any manual control takes playback back from the demo, at a comfortable speed. The demo's approvals so far
  // are kept, so a screen that rebuilds the day later arrives at the same place.
  const manual = (minute = SIM_START) => {
    if (next.autopilot) {
      next.speed = 20;
      next.autoApproveUntil = minute;
    }
    next.autopilot = false;
  };
  const anchor = (minute: number) => {
    next.anchorMinute = minute;
    next.anchorMs = nowMs;
  };
  switch (action) {
    case 'reset':
      manual();
      Object.assign(next, { run: cur.run + 1, mode: body.mode === 'baseline' ? 'baseline' : 'ai', autoApproveAtStart: cur.autoApprove, playing: false, autoApproveUntil: 0 });
      anchor(SIM_START);
      return { control: next };
    case 'demo':
      Object.assign(next, { run: cur.run + 1, mode: 'ai', autoApproveAtStart: cur.autoApprove, playing: true, autopilot: true, autoApproveUntil: 0 });
      anchor(SIM_START);
      return { control: next };
    case 'play': {
      const minute = clampMinute(body.minute);
      manual(minute);
      next.playing = !!body.playing;
      anchor(minute);
      return { control: next };
    }
    case 'speed': {
      const speed = Number(body.speed);
      if (!SPEEDS.includes(speed)) throw new ActionError('Unsupported speed');
      const minute = clampMinute(body.minute);
      manual(minute);
      next.speed = speed;
      anchor(minute);
      return { control: next };
    }
    case 'next-event': {
      const minute = clampMinute(body.minute);
      manual(Number(body.from) || minute);
      next.playing = false;
      anchor(minute);
      return { control: next };
    }
    case 'approve':
    case 'dismiss': {
      const minute = clampMinute(body.minute);
      // A decision releases the clock where the day was waiting for it.
      if (!cur.autopilot) anchor(minute);
      return { control: next, event: { run: cur.run, minute, kind: action, data: { id: String(body.id ?? '').slice(0, 20) } } };
    }
    case 'auto-approve': {
      const minute = clampMinute(body.minute);
      next.autoApprove = !!body.value;
      if (!cur.autopilot) anchor(minute);
      return { control: next, event: { run: cur.run, minute, kind: 'auto-approve', data: { value: !!body.value } } };
    }
    case 'issue': {
      const roomId = String(body.roomId ?? '');
      if (!/^[3-6](0[1-9]|1[0-2])$/.test(roomId)) throw new ActionError('Unknown room');
      const issue = String(body.issue ?? '').trim().slice(0, 60) || 'Maintenance issue';
      return { control: cur, event: { run: cur.run, minute: clampMinute(body.minute), kind: 'issue', data: { roomId, issue } } };
    }
    default:
      throw new ActionError(`Unknown action: ${action}`);
  }
}

/** Where the clock says the day is (manual playback), as a fractional minute. */
export function clockMinute(c: Control, nowMs: number): number {
  if (!c.playing || c.autopilot) return c.anchorMinute;
  return Math.min(SIM_END + 1, c.anchorMinute + (Math.max(0, nowMs - c.anchorMs) / 1000) * c.speed);
}

/**
 * Rebuilds the hotel from the shared timeline and keeps it there as time passes. Every screen and the
 * server run one of these; given the same control, events and time, they all arrive at the same state.
 */
export class Replay {
  sim!: Simulation;
  shadow?: Simulation;
  private run = -1;
  private applied = new Set<number>();
  /** Demo: real seconds into the demo at which the current minute became due. */
  private cursor = 0;
  private holdUntil: number | null = null;

  constructor(private withShadow = true) {}

  private rebuild(c: Control) {
    this.sim = new Simulation(c.mode);
    this.sim.state.autoApprove = c.autoApproveAtStart;
    if (this.withShadow) {
      this.shadow = new Simulation(c.mode === 'ai' ? 'baseline' : 'ai');
      this.shadow.state.autoApprove = true;
    }
    this.run = c.run;
    this.applied.clear();
    this.cursor = 0;
    this.holdUntil = null;
  }

  private apply(e: TimelineEvent) {
    const s = this.sim;
    if (e.kind === 'approve') s.approve(String(e.data.id));
    else if (e.kind === 'dismiss') s.dismiss(String(e.data.id));
    else if (e.kind === 'issue') s.reportIssue(String(e.data.roomId), String(e.data.issue));
    else if (e.kind === 'auto-approve') {
      s.state.autoApprove = !!e.data.value;
      const p = s.pendingProposal;
      if (s.state.autoApprove && p) s.approve(p.id);
    }
  }

  /** Applies the decisions that are due at the current minute. Returns how many were applied. */
  private applyDue(events: TimelineEvent[]) {
    let n = 0;
    for (const e of events) {
      if (this.applied.has(e.id) || e.minute > this.sim.state.now) continue;
      this.apply(e);
      this.applied.add(e.id);
      n++;
    }
    return n;
  }

  /**
   * Brings the hotel to where the timeline says it is at server time `nowMs`.
   * Returns true when anything visible changed.
   */
  sync(c: Control, allEvents: TimelineEvent[], nowMs: number): boolean {
    const events = allEvents.filter((e) => e.run === c.run).sort((a, b) => a.id - b.id);
    const target = clockMinute(c, nowMs);
    let rebuilt = false;
    const late = this.sim && events.some((e) => !this.applied.has(e.id) && e.minute < this.sim.state.now);
    const behind = this.sim && !c.autopilot && this.sim.state.now > Math.max(SIM_START, Math.ceil(target));
    if (!this.sim || c.run !== this.run || c.mode !== this.sim.state.mode || late || behind) {
      this.rebuild(c);
      rebuilt = true;
    }
    const s = this.sim;
    const before = this.fingerprint();

    if (c.autopilot) {
      const elapsed = Math.max(0, nowMs - c.anchorMs) / 1000;
      for (let guard = 0; guard < 2000; guard++) {
        this.applyDue(events);
        if (s.state.finished) break;
        const p = s.pendingProposal;
        if (p) {
          this.holdUntil ??= this.cursor + DEMO_HOLD_MS / 1000;
          if (elapsed < this.holdUntil) break;
          s.approve(p.id);
          this.cursor = this.holdUntil;
          this.holdUntil = null;
          continue;
        }
        const cost = 1 / demoSpeedAt(s.state.now);
        if (this.cursor + cost > elapsed) break;
        s.tick();
        this.cursor += cost;
      }
    } else {
      for (let guard = 0; guard < 2000; guard++) {
        this.applyDue(events);
        if (s.state.finished || s.state.now >= target) break;
        if (s.tick()) continue;
        const p = s.pendingProposal;
        if (p && s.state.now < c.autoApproveUntil) {
          s.approve(p.id); // a stopped demo had already approved this one
          continue;
        }
        if (this.applyDue(events) === 0) break; // waiting for a decision
      }
    }
    this.applyDue(events);

    const sh = this.shadow;
    if (sh) {
      for (let guard = 0; guard < 2000 && !sh.state.finished && (sh.state.now < s.state.now || s.state.finished); guard++) {
        if (!sh.tick()) break;
      }
    }

    // What the player shows comes from the shared control, not from whichever screen is looking.
    const waiting = !!s.pendingProposal;
    s.state.autopilot = c.autopilot && !s.state.finished;
    s.state.playing = c.playing && !s.state.finished && (c.autopilot || !waiting);
    s.state.speed = c.autopilot ? demoSpeedAt(s.state.now) : c.speed;
    if (waiting && !c.autopilot) s.state.pausedReason = 'Supervisor approval needed';

    return rebuilt || before !== this.fingerprint();
  }

  /** Everything a screen draws from, in brief: if this is unchanged, the screen needn't redraw. */
  private fingerprint() {
    const s = this.sim.state;
    const open = s.proposals.filter((p) => p.status === 'pending').length;
    return `${s.now}|${s.proposals.length}|${open}|${this.applied.size}|${s.autopilot}|${s.playing}|${s.speed}|${s.pausedReason ?? ''}|${this.holdUntil}`;
  }

  /** Whether the day is waiting for an approval in the demo (the decision card shows its hold bar). */
  get holding() {
    return this.holdUntil !== null;
  }
}
