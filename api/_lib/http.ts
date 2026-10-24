// Small helpers shared by the API functions (Vercel) and the local server, which mounts the same handlers.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resetStore } from './store.js';

export type Req = IncomingMessage & { body?: unknown };

export async function readBody(req: Req): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === 'object') return req.body as Record<string, unknown>;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString();
  return raw ? JSON.parse(raw) : {};
}

export const queryOf = (req: Req) => new URL(req.url ?? '/', 'http://local').searchParams;

export function send(res: ServerResponse, status: number, data: object) {
  if (res.headersSent) return; // this request already had its answer (it ran past its deadline)
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

type Handler = (req: Req, res: ServerResponse) => Promise<unknown>;

/**
 * Answers within `ms` even if the database stops responding. A connection that hangs is dropped, so the
 * next request on this instance starts on a fresh one instead of queueing behind it forever.
 */
export function withDeadline(handler: Handler, ms = 8000): Handler {
  return async (req, res) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<'late'>((r) => (timer = setTimeout(() => r('late'), ms)));
    const outcome = await Promise.race([handler(req, res).then(() => 'done' as const, () => 'done' as const), late]);
    clearTimeout(timer);
    if (outcome === 'late') {
      console.error(`${req.method} ${req.url}: no answer from the database in ${ms} ms; reconnecting`);
      resetStore();
      send(res, 503, { ok: false, message: 'The hotel’s system didn’t answer. Please try again in a moment.' });
    }
  };
}
