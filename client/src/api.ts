import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { SimState } from '../../shared/types';
import { adminHeaders } from './session';

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
      headers: { ...(path.startsWith('/api/guest') ? {} : adminHeaders()), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout?.(12_000),
    });
  } catch {
    throw new ApiError('Can’t reach the server. Check the connection.', 0);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    if (res.status === 401 && (data as { code?: string } | null)?.code === 'ADMIN_SESSION_REQUIRED') window.dispatchEvent(new Event('fhn:session-expired'));
    const msg = (data as { message?: string } | null)?.message ?? `Request failed (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

// ───────── Stage controls (optionally PIN-protected) ─────────
const PIN_KEY = 'fhn.stagePin';
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
export function useEventStream<T>(url: string | null): { data: T | null; conn: Conn } {
  const [data, setData] = useState<T | null>(null);
  const [conn, setConn] = useState<Conn>('connecting');
  const retry = useRef(0);

  useEffect(() => {
    if (!url) return;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const open = async () => {
      controller?.abort();
      const active = new AbortController();
      controller = active;
      try {
        const response = await fetch(url, { headers: adminHeaders(), signal: active.signal });
        if (response.status === 401) {
          window.dispatchEvent(new Event('fhn:session-expired'));
          return;
        }
        if (!response.ok || !response.body) throw new Error('Stream unavailable');
        retry.current = 0;
        setConn('live');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
          while (!active.signal.aborted) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '');
            let boundary: number;
            while ((boundary = buffer.indexOf('\n\n')) >= 0) {
              const frame = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
              if (data) try { setData(JSON.parse(data) as T); } catch { /* ignore malformed frame */ }
            }
          }
        } finally { reader.releaseLock(); }
      } catch { /* reconnect unless the page deliberately closed this stream */ }
      if (closed || active.signal.aborted) return;
      setConn('reconnecting');
      timer = setTimeout(() => void open(), Math.min(10000, 500 * 2 ** retry.current++));
    };
    const onHide = () => { controller?.abort(); if (timer) clearTimeout(timer); };
    const onShow = (e: PageTransitionEvent) => { if (e.persisted && !closed) void open(); };
    window.addEventListener('pagehide', onHide);
    window.addEventListener('pageshow', onShow);
    void open();
    return () => {
      closed = true;
      onHide();
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('pageshow', onShow);
    };
  }, [url]);

  return { data, conn };
}

export const SimContext = createContext<{ state: SimState | null; conn: Conn }>({ state: null, conn: 'connecting' });
export const useSim = () => useContext(SimContext);

// ───────── Toasts ─────────
export interface Toast {
  id: number;
  title: string;
  body?: string;
  tone?: 'good' | 'bad' | 'neutral';
  /** Shown in the hotel view when a guest does something in the guest app. */
  fromGuest?: boolean;
}
type ToastFn = (t: Omit<Toast, 'id'>) => void;
export const ToastContext = createContext<ToastFn>(() => undefined);
export const useToast = () => useContext(ToastContext);
