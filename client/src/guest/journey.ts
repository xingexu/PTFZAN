// The guest's stay as the guest app sees it: saved by the hotel's API (Postgres), shown on this phone.
// The phone keeps only the stay's secret id; the stay itself comes from the server. Actions show at once
// (worked out here with the same rules the server uses) and are then confirmed by the server — except
// check-in, where the server chooses the room, so the phone waits for its answer.
import { useCallback, useEffect, useState } from 'react';
import { apply, viewOf, type Stay } from '../../../shared/guest/stay';
import { api, ApiError } from '../api';

const ID_KEY = 'fhn.guest.id';
const SYNC_MS = 15000;
/** Check-in shows "FHN AI is choosing your room" for at least this long, so the moment registers. */
const CHOOSING_MS = 1300;

export const savedStayId = () => {
  try {
    return localStorage.getItem(ID_KEY) ?? '';
  } catch {
    return '';
  }
};
const remember = (id: string | null) => {
  try {
    if (id) localStorage.setItem(ID_KEY, id);
    else localStorage.removeItem(ID_KEY);
  } catch {
    /* private mode: the stay lasts for this page only */
  }
};

type Reply = { ok: boolean; stay: Stay; now: number };

/** The server's clock minus this phone's: every time on screen (and the countdown) uses the server's clock. */
let skewMs = 0;
export const serverNow = () => Date.now() + skewMs;

/** Registers a guest. Resolves once the hotel has saved them. */
export async function register(input: { name: string; email?: string; party: number }) {
  const r = await api<Reply>('/api/guest', { action: 'register', ...input });
  remember(r.stay.id);
  return r.stay;
}

export type StayStatus = 'loading' | 'ready' | 'none' | 'offline';

/** The guest's stay for React: re-derived every second so messages land on time. */
export function useJourney() {
  const [stay, setStay] = useState<Stay | null>(null);
  const [status, setStatus] = useState<StayStatus>(() => (savedStayId() ? 'loading' : 'none'));
  const [now, setNow] = useState(serverNow);
  const sync = (r: { now: number }) => (skewMs = r.now - Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNow(serverNow()), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    const id = savedStayId();
    if (!id) return;
    let stop = false;
    let retry: number | undefined;
    const load = () =>
      api<Reply>(`/api/guest?id=${encodeURIComponent(id)}`)
        .then((r) => {
          if (stop) return;
          sync(r);
          setStay(r.stay);
          setStatus('ready');
        })
        .catch((e) => {
          if (stop) return;
          if (e instanceof ApiError && e.status === 404) {
            remember(null);
            setStatus('none');
          } else {
            setStatus('offline');
            retry = window.setTimeout(load, 4000);
          }
        });
    void load();
    // Stay in step with the hotel's records: re-read every so often and whenever the app comes back into view.
    const every = window.setInterval(() => void (document.hidden || load()), SYNC_MS);
    const onShow = () => !document.hidden && void load();
    document.addEventListener('visibilitychange', onShow);
    return () => {
      stop = true;
      window.clearTimeout(retry);
      window.clearInterval(every);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, []);

  /** Runs a guest action. Resolves with a confirmation to show, or rejects with a reason. */
  const act = useCallback(
    async (action: string, body: Record<string, unknown> = {}) => {
      if (!stay) throw new Error('Please register first.');
      if (action === 'check-in') {
        const [r] = await Promise.all([api<Reply>('/api/guest', { action, id: stay.id }), new Promise((ok) => setTimeout(ok, CHOOSING_MS))]);
        sync(r);
        setStay(r.stay);
        setNow(serverNow());
        return r.stay.plan ? `Room ${r.stay.plan.roomId}` : 'Checked in';
      }
      const draft = structuredClone(stay);
      const message = apply(draft, action, body, serverNow());
      setStay(draft);
      try {
        const r = await api<Reply>('/api/guest', { ...body, action, id: stay.id });
        sync(r);
        setStay(r.stay);
      } catch (e) {
        setStay(stay);
        throw e;
      }
      setNow(serverNow());
      return message;
    },
    [stay],
  );

  /** Ends the stay on this phone and deletes the guest's details from the hotel's records. */
  const end = useCallback(async () => {
    if (stay) await api('/api/guest', { action: 'end', id: stay.id }).catch(() => undefined);
    remember(null);
    setStay(null);
    setStatus('none');
  }, [stay]);

  return { view: stay ? viewOf(stay, now) : null, status, act, end };
}
