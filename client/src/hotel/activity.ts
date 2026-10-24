// What guests are doing in the guest app, read from the hotel's database every few seconds.
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { LiveArrival } from '../../../shared/guest/stay';
import { api } from '../api';

export interface ActivityItem {
  id: number;
  at: number;
  kind: string;
  text: string;
}
export interface GuestActivity {
  items: ActivityItem[];
  counts: { registered: number; checkedIn: number } | null;
  /** Guests who checked in on their phones, with the same clock as each phone. */
  arrivals: LiveArrival[];
  /** The server's clock minus this screen's. */
  skew: number;
  /** The hotel's database answered the last time we asked. */
  online: boolean;
}

/** An app guest is shown from check-in until they open their room, for at most this long. */
const SHOW_MS = 30 * 60_000;
export type ArrivalPhase = 'waiting' | 'cleaning' | 'check' | 'ready';

/** Where an app guest's room stands at `now` (server clock), and how far to the time they were promised. */
export function arrivalState(a: LiveArrival, now: number) {
  const phase: ArrivalPhase = now >= a.readyMs ? 'ready' : now >= a.checkMs ? 'check' : now >= a.cleanMs ? 'cleaning' : 'waiting';
  const left = Math.max(0, Math.ceil((a.highMs - now) / 1000));
  const pct = Math.min(100, Math.max(0, ((now - a.startMs) / Math.max(1, a.highMs - a.startMs)) * 100));
  return { phase, left, pct };
}
export const waitingArrivals = (list: LiveArrival[], now: number) => list.filter((a) => !a.inRoomMs && now - a.startMs < SHOW_MS);
export const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

/** Countdowns refresh this often, so each turns over within a fraction of a second of the guest's phone. */
const COUNTDOWN_TICK_MS = 200;

/** The server's time, ticking while `on` (so countdowns on the hotel screen match the phones). */
export function useServerNow(skew: number, on: boolean) {
  const [now, setNow] = useState(() => Date.now() + skew);
  useEffect(() => {
    if (!on) return;
    setNow(Date.now() + skew);
    const t = window.setInterval(() => setNow(Date.now() + skew), COUNTDOWN_TICK_MS);
    return () => window.clearInterval(t);
  }, [skew, on]);
  return now;
}

const POLL_MS = 4000;
const KEEP = 30;

export const ActivityContext = createContext<GuestActivity>({ items: [], counts: null, arrivals: [], skew: 0, online: false });
export const useActivity = () => useContext(ActivityContext);

/** Polls /api/activity, and right away whenever the hotel screen comes back into view. */
export function useActivityFeed(): GuestActivity {
  const [feed, setFeed] = useState<GuestActivity>({ items: [], counts: null, arrivals: [], skew: 0, online: false });
  const last = useRef(0);
  useEffect(() => {
    let stop = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const sent = Date.now();
        const r = await api<{ items: ActivityItem[]; counts: GuestActivity['counts']; arrivals?: LiveArrival[]; now: number }>(`/api/activity?after=${last.current}`);
        if (stop) return;
        if (r.items.length) last.current = Math.max(last.current, ...r.items.map((i) => i.id));
        // Rounded so a new measurement doesn't restart the countdown ticker for a few milliseconds' difference.
        const skew = Math.round((r.now + (Date.now() - sent) / 2 - Date.now()) / 50) * 50;
        setFeed((f) => ({ items: [...r.items, ...f.items].slice(0, KEEP), counts: r.counts, arrivals: r.arrivals ?? [], skew, online: true }));
      } catch {
        if (!stop) setFeed((f) => (f.online ? { ...f, online: false } : f));
      }
      if (!stop) timer = window.setTimeout(poll, document.hidden ? POLL_MS * 3 : POLL_MS);
    };
    const onShow = () => {
      if (document.hidden) return;
      window.clearTimeout(timer);
      void poll();
    };
    document.addEventListener('visibilitychange', onShow);
    void poll();
    return () => {
      stop = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, []);
  return feed;
}
