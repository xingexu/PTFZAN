// The hotel day runs right here in the browser, so the hotel view works as a static site.
// It replays October 16 twice in lockstep: the way shown on screen, and a shadow run in the other mode
// that every screen compares against.
import { useSyncExternalStore } from 'react';
import { DEMO_HOLD_MS, demoSpeedAt } from '../../../shared/sim/demo';
import { Simulation } from '../../../shared/sim/engine';
import type { Mode, SimState } from '../../../shared/types';

const FRAME_MS = 100;
const SPEEDS = [5, 10, 20, 30, 60];

class HotelHost {
  private sim = new Simulation('ai');
  private shadow = new Simulation('baseline');
  private carry = 0;
  /** Demo autopilot: when the pending plan appeared (epoch ms). */
  private holdSince = 0;
  private listeners = new Set<() => void>();
  private snap: SimState;

  constructor() {
    this.shadow.state.autoApprove = true;
    this.snap = this.snapshot();
    window.setInterval(() => this.frame(), FRAME_MS);
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.snap;

  private snapshot(): SimState {
    const s = structuredClone(this.sim.state);
    const o = this.shadow.state;
    s.compare = {
      mode: o.mode,
      now: o.now,
      metrics: structuredClone(o.metrics),
      rooms: o.rooms.map((r) => ({ id: r.id, status: r.status, groupBlock: r.groupBlock })),
    };
    return s;
  }

  private emit() {
    this.snap = this.snapshot();
    for (const fn of this.listeners) fn();
  }

  private frame() {
    const s = this.sim.state;
    if (s.autopilot && !s.finished) {
      const p = this.sim.pendingProposal;
      if (p) {
        // Leave the decision on screen for a beat, then the supervisor approves.
        if (!this.holdSince) this.holdSince = Date.now();
        else if (Date.now() - this.holdSince >= DEMO_HOLD_MS) {
          this.holdSince = 0;
          this.sim.approve(p.id);
          s.playing = true;
          this.emit();
        }
        return;
      }
      s.speed = demoSpeedAt(s.now);
    }
    if (!s.playing || s.finished) return;
    this.carry += (s.speed * FRAME_MS) / 1000;
    let moved = false;
    while (this.carry >= 1) {
      this.carry -= 1;
      if (!this.sim.tick()) {
        this.carry = 0;
        break;
      }
      moved = true;
    }
    this.syncShadow();
    if (moved || !s.playing) this.emit();
  }

  /** Bring the shadow run to the same minute as the main run. */
  private syncShadow() {
    const main = this.sim.state;
    while (!this.shadow.state.finished && (this.shadow.state.now < main.now || main.finished)) {
      if (!this.shadow.tick()) break;
    }
  }

  private resetBoth(mode: Mode) {
    this.sim.reset(mode, { speed: this.sim.state.speed, autoApprove: this.sim.state.autoApprove });
    this.shadow.reset(mode === 'ai' ? 'baseline' : 'ai', { autoApprove: true });
    this.carry = 0;
    this.holdSince = 0;
  }

  /** Any manual control hands playback back to the presenter. */
  private manual() {
    if (this.sim.state.autopilot) this.sim.state.speed = 20;
    this.sim.state.autopilot = false;
    this.holdSince = 0;
  }

  /** The hotel's controls. Throws with a readable message when an action isn't possible right now. */
  run(action: string, body: Record<string, unknown> = {}): string | undefined {
    const s = this.sim.state;
    let message: string | undefined;
    switch (action) {
      case 'reset':
        this.manual();
        this.resetBoth(body.mode === 'baseline' ? 'baseline' : 'ai');
        break;
      case 'demo':
        this.resetBoth('ai');
        this.sim.state.autopilot = true;
        this.sim.state.speed = demoSpeedAt(this.sim.state.now);
        this.sim.state.playing = true;
        break;
      case 'play':
        if (s.finished) throw new Error('The day is over. Start again to replay it.');
        if (this.sim.pendingProposal && body.playing) throw new Error('Approve or keep the current plan first.');
        this.manual();
        s.playing = !!body.playing;
        if (s.playing) s.pausedReason = undefined;
        break;
      case 'speed': {
        const speed = Number(body.speed);
        if (!SPEEDS.includes(speed)) throw new Error('Unsupported speed');
        this.manual();
        s.speed = speed;
        break;
      }
      case 'next-event':
        this.manual();
        s.playing = false;
        this.sim.nextEvent();
        this.syncShadow();
        break;
      case 'auto-approve':
        s.autoApprove = !!body.value;
        if (s.autoApprove && this.sim.pendingProposal) this.sim.approve(this.sim.pendingProposal.id);
        break;
      case 'approve':
        if (!this.sim.approve(String(body.id))) throw new Error('That plan is no longer waiting.');
        break;
      case 'dismiss':
        if (!this.sim.dismiss(String(body.id))) throw new Error('That plan is no longer waiting.');
        break;
      case 'issue': {
        const r = this.sim.reportIssue(String(body.roomId), String(body.issue ?? '').trim().slice(0, 60) || 'Maintenance issue');
        if (!r.ok) throw new Error(r.message);
        message = r.message;
        break;
      }
      default:
        throw new Error(`Unknown action: ${action}`);
    }
    this.emit();
    return message;
  }
}

let host: HotelHost | null = null;
const getHost = () => (host ??= new HotelHost());

/** The live hotel day for React. */
export function useHotel(): SimState {
  const h = getHost();
  return useSyncExternalStore(h.subscribe, h.getState);
}

/** Runs a hotel control (reset, demo, play, approve…). Resolves with an optional message. */
export async function hotel(action: string, body: Record<string, unknown> = {}): Promise<{ message?: string }> {
  return { message: getHost().run(action, body) };
}
