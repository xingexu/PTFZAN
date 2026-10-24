// The hotel day, shared by every screen. The server keeps one timeline in Postgres (a clock and a log of
// decisions); this screen rebuilds the same day from it and follows it as time passes, so every open hotel
// view shows the same rooms at the same moment and any of them can drive. Without the server (no network,
// or `vite` on its own) the day still runs here, on this screen only.
import { useSyncExternalStore } from 'react';
import { applyAction, initialControl, Replay, type Control, type TimelineEvent } from '../../../shared/sim/timeline';
import type { SimState } from '../../../shared/types';
import { api, ApiError } from '../api';
import { fade } from '../components/fade';

const FRAME_MS = 100;
const POLL_PLAYING_MS = 1000;
const POLL_IDLE_MS = 2500;
const POLL_HIDDEN_MS = 8000;
const RETRY_OFFLINE_MS = 5000;
/** Ids for decisions made while offline, above anything the database hands out. */
const LOCAL_IDS = 1_000_000_000;

export type SyncStatus = 'connecting' | 'live' | 'offline';
export interface SyncInfo {
  status: SyncStatus;
  /** Screens with the hotel view open right now, this one included. */
  viewers: number;
}
interface HotelReply {
  control: Control;
  events: TimelineEvent[];
  serverNow: number;
  viewers?: number;
}

/** A name for this tab, so the server can count open screens. */
const viewerId = () => {
  const make = () => Array.from({ length: 16 }, () => 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 32)]).join('');
  try {
    const id = sessionStorage.getItem('fhn.viewer') ?? make();
    sessionStorage.setItem('fhn.viewer', id);
    return id;
  } catch {
    return make();
  }
};

/** Describes a change another screen made, for a short notice on this one. */
function describe(prev: Control, next: Control): string | null {
  if (next.run !== prev.run) return next.autopilot ? 'Another screen started the 30-second demo' : `Another screen restarted the day${next.mode === 'baseline' ? ' with the previous method' : ' with FHN AI'}`;
  if (next.playing !== prev.playing) return next.playing ? 'Another screen pressed play' : 'Another screen paused the day';
  if (next.speed !== prev.speed && !next.autopilot) return 'Another screen changed the speed';
  return null;
}

class HotelHost {
  private replay = new Replay(true);
  private control: Control = initialControl(Date.now());
  private events: TimelineEvent[] = [];
  /** Server clock minus this device's clock, from the most precise recent measurement. */
  private offset = 0;
  private bestRtt = Infinity;
  private ownVersions = new Set<number>();
  private localSeq = 0;
  private viewer = viewerId();
  private pollTimer = 0;
  private frameTimer = 0;
  private stopped = false;
  private onVisibility = () => { if (!document.hidden) void this.poll(); };
  private listeners = new Set<() => void>();
  private syncListeners = new Set<() => void>();
  private remoteListeners = new Set<(text: string) => void>();
  private snap: SimState;
  private sync: SyncInfo = { status: 'connecting', viewers: 1 };

  constructor() {
    this.replay.sync(this.control, this.events, this.now());
    this.snap = this.snapshot();
    this.frameTimer = window.setInterval(() => this.frame(), FRAME_MS);
    document.addEventListener('visibilitychange', this.onVisibility);
    void this.poll();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getState = () => this.snap;
  subscribeSync = (fn: () => void) => {
    this.syncListeners.add(fn);
    return () => void this.syncListeners.delete(fn);
  };
  getSync = () => this.sync;
  onRemote(fn: (text: string) => void) {
    this.remoteListeners.add(fn);
    return () => void this.remoteListeners.delete(fn);
  }

  private now() {
    return Date.now() + this.offset;
  }

  private snapshot(): SimState {
    const s = structuredClone(this.replay.sim.state);
    const o = this.replay.shadow?.state;
    if (o) s.compare = { mode: o.mode, now: o.now, metrics: structuredClone(o.metrics), rooms: o.rooms.map((r) => ({ id: r.id, status: r.status, groupBlock: r.groupBlock })) };
    return s;
  }

  private emit() {
    this.snap = this.snapshot();
    for (const fn of this.listeners) fn();
  }

  private frame() {
    if (this.replay.sync(this.control, this.events, this.now())) this.emit();
  }

  private setSync(status: SyncStatus, viewers = this.sync.viewers) {
    if (status === this.sync.status && viewers === this.sync.viewers) return;
    this.sync = { status, viewers };
    for (const fn of this.syncListeners) fn();
  }

  private measure(sentAt: number, serverNow: number) {
    const rtt = Date.now() - sentAt;
    // Keep the estimate from the quickest round trip; it is the least distorted by the network.
    if (rtt <= this.bestRtt * 1.5 || Math.abs(serverNow + rtt / 2 - Date.now() - this.offset) > 1500) {
      this.bestRtt = Math.min(this.bestRtt, rtt);
      this.offset = serverNow + rtt / 2 - Date.now();
    }
  }

  /** Takes the server's timeline as the truth. `full` = the reply has every event of its run. */
  private adopt(r: HotelReply, full: boolean) {
    const prev = this.control;
    const newer = r.control.run !== prev.run || r.control.version >= prev.version || this.sync.status !== 'live';
    if (newer) {
      if (this.sync.status === 'live' && r.control.version !== prev.version && !this.ownVersions.has(r.control.version)) {
        const text = describe(prev, r.control);
        if (text) for (const fn of this.remoteListeners) fn(text);
      }
      this.control = r.control;
    }
    const sameRun = this.events.filter((e) => e.run === this.control.run && e.id < LOCAL_IDS);
    const incoming = r.events.filter((e) => e.run === this.control.run);
    if (full) this.events = incoming;
    else {
      const known = new Set(sameRun.map((e) => e.id));
      this.events = [...sameRun, ...incoming.filter((e) => !known.has(e.id))];
    }
  }

  private async poll() {
    if (this.stopped) return;
    window.clearTimeout(this.pollTimer);
    const sentAt = Date.now();
    const run = this.control.run;
    const after = Math.max(0, ...this.events.filter((e) => e.run === run && e.id < LOCAL_IDS).map((e) => e.id));
    try {
      const r = await api<HotelReply>(`/api/hotel?run=${run}&after=${after}&viewer=${this.viewer}`);
      this.measure(sentAt, r.serverNow);
      const wasOffline = this.sync.status !== 'live';
      this.adopt(r, r.control.run !== run || wasOffline);
      this.setSync('live', r.viewers ?? 1);
      // Joining the shared day, or a new day started on another screen, cross-fades rather than jumps.
      if (wasOffline || this.control.run !== run) fade(() => this.frame());
      else this.frame();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { this.dispose(); return; }
      this.setSync('offline', 1);
    }
    if (this.stopped) return;
    const busy = this.control.playing || this.control.autopilot;
    const wait = this.sync.status === 'offline' ? RETRY_OFFLINE_MS : document.hidden ? POLL_HIDDEN_MS : busy ? POLL_PLAYING_MS : POLL_IDLE_MS;
    this.pollTimer = window.setTimeout(() => void this.poll(), wait);
  }

  dispose() {
    this.stopped = true;
    window.clearTimeout(this.pollTimer);
    window.clearInterval(this.frameTimer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.listeners.clear(); this.syncListeners.clear(); this.remoteListeners.clear();
  }

  /** The hotel's controls. Throws with a readable message when an action isn't possible right now. */
  async run(action: string, body: Record<string, unknown> = {}): Promise<string | undefined> {
    const sim = this.replay.sim;
    const s = sim.state;
    if (action === 'play' && body.playing && s.finished) throw new Error('The day is over. Start again to replay it.');
    if (action === 'play' && body.playing && sim.pendingProposal) throw new Error('Approve or keep the current plan first.');
    if ((action === 'approve' || action === 'dismiss') && !s.proposals.some((p) => p.id === body.id && p.status === 'pending'))
      throw new Error('That plan is no longer waiting.');
    let minute = s.now;
    if (action === 'next-event') {
      // Where "skip" lands: just past the next moment of the day (or at a decision, if one comes up).
      const probe = new Replay(false);
      const c = this.control;
      probe.sync({ ...c, playing: false, autopilot: false, anchorMinute: s.now, autoApproveUntil: c.autopilot ? s.now : c.autoApproveUntil }, this.events, this.now());
      probe.sim.nextEvent();
      minute = probe.sim.state.now;
    }
    const payload = { ...body, action, minute, from: s.now, viewer: this.viewer };
    const logBefore = s.log.length;
    try {
      let sentAt = Date.now();
      const r = await api<HotelReply>('/api/hotel', payload).catch((e) => {
        // One more try if the server was momentarily unreachable (it reconnects to the database on its own).
        if (!(e instanceof ApiError && (e.status === 0 || e.status >= 500))) throw e;
        sentAt = Date.now();
        return api<HotelReply>('/api/hotel', payload);
      });
      this.measure(sentAt, r.serverNow);
      this.ownVersions.add(r.control.version);
      this.adopt(r, true);
      this.setSync('live');
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw new Error(e.message);
      // No server: run the day on this screen.
      const { control, event } = applyAction(this.control, action, payload, this.now());
      this.control = control;
      if (event) this.events = [...this.events, { ...event, id: LOCAL_IDS + ++this.localSeq }];
      this.setSync('offline', 1);
    }
    this.frame();
    if (action === 'next-event' || action === 'play') void this.poll();
    const log = this.replay.sim.state.log;
    return action === 'issue' && log.length > logBefore ? log[0]?.text : undefined;
  }
}

let host: HotelHost | null = null;
export function stopHotel() { host?.dispose(); host = null; }
const getHost = () => (host ??= new HotelHost());

/** The live hotel day for React. */
export function useHotel(): SimState {
  const h = getHost();
  return useSyncExternalStore(h.subscribe, h.getState);
}

/** Whether this screen is in step with the others, and how many are open. */
export function useHotelSync(): SyncInfo {
  const h = getHost();
  return useSyncExternalStore(h.subscribeSync, h.getSync);
}

/** Notices about changes made on other screens. Returns an unsubscribe function. */
export const onRemoteChange = (fn: (text: string) => void) => getHost().onRemote(fn);

/** Runs a hotel control (reset, demo, play, approve…). Resolves with an optional message. */
export async function hotel(action: string, body: Record<string, unknown> = {}): Promise<{ message?: string }> {
  return { message: await getHost().run(action, body) };
}
