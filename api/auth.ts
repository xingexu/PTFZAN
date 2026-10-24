// Hotel staff sign-in. Runs as a Vercel serverless function (/api/auth) and inside the local server.
// Credentials come only from environment variables (ADMIN_USERNAME, ADMIN_PASSWORD) — never from the code.
// Sessions are stateless: a signed token that expires, so nothing needs to be stored.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const SESSION_HOURS = 12;

const env = (k: string) => process.env[k]?.trim() || undefined;

export const adminConfigured = () => !!(env('ADMIN_USERNAME') && env('ADMIN_PASSWORD'));

const same = (a: string, b: string) => {
  // Compare digests so different lengths take the same time.
  const da = createHash('sha256').update(a).digest();
  const db = createHash('sha256').update(b).digest();
  return timingSafeEqual(da, db);
};

export function checkLogin(username: string, password: string): boolean {
  const u = env('ADMIN_USERNAME');
  const p = env('ADMIN_PASSWORD');
  if (!u || !p) return false;
  // Evaluate both so a wrong username and a wrong password take the same time.
  const okUser = same(username.trim(), u);
  const okPass = same(password, p);
  return okUser && okPass;
}

const secret = () => env('SESSION_SECRET') ?? createHash('sha256').update(`fhn-session|${env('ADMIN_USERNAME')}|${env('ADMIN_PASSWORD')}`).digest('hex');
const b64 = (s: string) => Buffer.from(s).toString('base64url');
const sign = (body: string) => createHmac('sha256', secret()).update(body).digest('base64url');

export function issueSession(username: string): string {
  const body = b64(JSON.stringify({ u: username, exp: Date.now() + SESSION_HOURS * 3600_000 }));
  return `${body}.${sign(body)}`;
}

export function verifySession(token: string): { u: string } | null {
  const [body, sig] = String(token).split('.');
  if (!body || !sig || !same(sig, sign(body))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString()) as { u: string; exp: number };
    return data.exp > Date.now() ? { u: data.u } : null;
  } catch {
    return null;
  }
}

type Req = IncomingMessage & { body?: unknown };

async function readBody(req: Req): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === 'object') return req.body as Record<string, unknown>;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString();
  return raw ? JSON.parse(raw) : {};
}

const send = (res: ServerResponse, status: number, data: object) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
};

/** POST { action: 'login', username, password } → { token } · POST { action: 'session', token } → { user } */
export default async function handler(req: Req, res: ServerResponse) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, message: 'Use POST' });
  let body: Record<string, unknown>;
  try {
    body = await readBody(req);
  } catch {
    return send(res, 400, { ok: false, message: 'Bad request' });
  }
  if (body.action === 'session') {
    const s = verifySession(String(body.token ?? ''));
    return s ? send(res, 200, { ok: true, user: s.u }) : send(res, 401, { ok: false, message: 'Please sign in again.' });
  }
  if (body.action === 'login') {
    if (!adminConfigured()) return send(res, 503, { ok: false, message: 'Staff sign-in isn’t set up on this server yet.' });
    const username = String(body.username ?? '');
    if (!checkLogin(username, String(body.password ?? ''))) return send(res, 401, { ok: false, message: 'That username and password don’t match.' });
    return send(res, 200, { ok: true, token: issueSession(username.trim()), user: username.trim() });
  }
  return send(res, 400, { ok: false, message: 'Unknown action' });
}
