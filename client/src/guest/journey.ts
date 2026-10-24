// The guest's stay as the guest app sees it: saved by the hotel's API (Postgres), shown on this phone.
// The phone keeps only the stay's secret id; the stay itself comes from the server. Actions show at once
// (worked out here with the same rules the server uses) and are then confirmed by the server.
import { useCallback, useEffect, useRef, useState } from 'react';
import { apply, viewOf, type Stay } from '../../../shared/guest/stay';
import { api, ApiError } from '../api';

const ID_KEY = 'fhn.guest.id';

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
  // The phone's clock may be off; times come from the server's clock.
  const skew = useRef(0);
  const [now, setNow] = useState(() => Date.now());
  const sync = (r: { now: number }) => (skew.current = r.now - Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now() + skew.current), 1000);
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
    return () => {
      stop = true;
      window.clearTimeout(retry);
    };
  }, []);

  /** Runs a guest action. Resolves with a confirmation to show, or rejects with a reason. */
  const act = useCallback(
    async (action: string, body: Record<string, unknown> = {}) => {
      if (!stay) throw new Error('Please register first.');
      const draft = structuredClone(stay);
      const message = apply(draft, action, body, Date.now() + skew.current);
      setStay(draft);
      try {
        const r = await api<Reply>('/api/guest', { ...body, action, id: stay.id });
        sync(r);
        setStay(r.stay);
      } catch (e) {
        setStay(stay);
        throw e;
      }
      setNow(Date.now() + skew.current);
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
