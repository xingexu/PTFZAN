import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { SimState } from '../../shared/types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T = { ok: boolean; message?: string }>(path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Cannot reach the ReadyPath server. Check the connection.', 0);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const msg = (data as { message?: string } | null)?.message ?? `Request failed (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

// ───────── Stage controls (optionally PIN-protected) ─────────
const PIN_KEY = 'readypath.stagePin';
export const getStagePin = () => {
  try {
    return sessionStorage.getItem(PIN_KEY) ?? '';
  } catch {
    return '';
  }
};
export const setStagePin = (pin: string) => {
  try {
    sessionStorage.setItem(PIN_KEY, pin);
  } catch {
    /* private mode */
  }
};
export const stageApi = <T = { ok: boolean; message?: string }>(path: string, body: unknown = {}) =>
  api<T>(`/api/stage/${path}`, body, { 'x-stage-pin': getStagePin() });

export type Conn = 'connecting' | 'live' | 'reconnecting';

/** Subscribe to a Server-Sent Events URL and keep the latest JSON payload. Reconnects with backoff. */
export function useEventStream<T>(url: string | null): { data: T | null; conn: Conn; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [conn, setConn] = useState<Conn>('connecting');
  const [error, setError] = useState<string | null>(null);
  const retry = useRef(0);

  useEffect(() => {
    if (!url) return;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const open = () => {
      es = new EventSource(url);
      es.onopen = () => {
        retry.current = 0;
        setConn('live');
        setError(null);
      };
      es.onmessage = (e) => {
        try {
          setData(JSON.parse(e.data) as T);
        } catch {
          /* ignore malformed frame */
        }
      };
      es.onerror = () => {
        es?.close();
        if (closed) return;
        setConn('reconnecting');
        // A 404 on a guest stream means a bad code; check once so we can show a clear message.
        fetch(url.replace(/\/stream$/, ''))
          .then(async (r) => {
            if (r.status === 404) {
              const j = await r.json().catch(() => ({}));
              setError((j as { message?: string }).message ?? 'Not found');
              closed = true;
            }
          })
          .catch(() => undefined);
        const delay = Math.min(10000, 500 * 2 ** retry.current++);
        timer = setTimeout(() => !closed && open(), delay);
      };
    };
    open();
    return () => {
      closed = true;
      es?.close();
      if (timer) clearTimeout(timer);
    };
  }, [url]);

  return { data, conn, error };
}

export const SimContext = createContext<{ state: SimState | null; conn: Conn }>({ state: null, conn: 'connecting' });
export const useSim = () => useContext(SimContext);

// ───────── Toasts ─────────
export interface Toast {
  id: number;
  title: string;
  body?: string;
  tone?: 'good' | 'bad' | 'neutral';
}
type ToastFn = (t: Omit<Toast, 'id'>) => void;
export const ToastContext = createContext<ToastFn>(() => undefined);
export const useToast = () => useContext(ToastContext);
