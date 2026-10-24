// Small helpers shared by the API functions (Vercel) and the local server, which mounts the same handlers.
import type { IncomingMessage, ServerResponse } from 'node:http';

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
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}
