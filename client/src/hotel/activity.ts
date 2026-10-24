// What guests are doing in the guest app, read from the hotel's database every few seconds.
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useToast } from '../api';

export interface ActivityItem {
  id: number;
  at: number;
  kind: string;
  text: string;
}
export interface GuestActivity {
  items: ActivityItem[];
  counts: { registered: number; checkedIn: number } | null;
  /** The hotel's database answered the last time we asked. */
  online: boolean;
}

const POLL_MS = 4000;
const KEEP = 30;

export const ActivityContext = createContext<GuestActivity>({ items: [], counts: null, online: false });
export const useActivity = () => useContext(ActivityContext);

/** Polls /api/activity; new items also pop up as a toast on the hotel screen. */
export function useActivityFeed(): GuestActivity {
  const toast = useToast();
  const [feed, setFeed] = useState<GuestActivity>({ items: [], counts: null, online: false });
  const last = useRef(0);
  const first = useRef(true);
  useEffect(() => {
    let stop = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const r = await api<{ items: ActivityItem[]; counts: GuestActivity['counts'] }>(`/api/activity?after=${last.current}`);
        if (stop) return;
        if (r.items.length) last.current = Math.max(last.current, ...r.items.map((i) => i.id));
        if (!first.current) for (const i of [...r.items].reverse()) toast({ title: 'From the guest app', body: i.text, fromGuest: true });
        first.current = false;
        setFeed((f) => ({ items: [...r.items, ...f.items].slice(0, KEEP), counts: r.counts, online: true }));
      } catch {
        if (!stop) setFeed((f) => (f.online ? { ...f, online: false } : f));
      }
      if (!stop) timer = window.setTimeout(poll, document.hidden ? POLL_MS * 3 : POLL_MS);
    };
    void poll();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [toast]);
  return feed;
}
