import { createHash, scrypt, timingSafeEqual } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { getIronSession, type IronSession } from 'iron-session';
import { send, type Req } from './http.js';

export const SESSION_SECONDS = 3600;
export interface AdminSession { username?: string; expiresAt?: number; credentialVersion?: string; tabHash?: string }
export function tabHash(req: Req) {
  const key = String(req.headers['x-fhn-session'] ?? '');
  return /^[a-f0-9]{64}$/.test(key) ? createHash('sha256').update(key).digest('hex') : '';
}

export function adminConfig() {
  const username = process.env.ADMIN_USERNAME?.trim();
  const passwordHash = process.env.ADMIN_PASSWORD_HASH?.trim();
  const sessionSecret = process.env.ADMIN_SESSION_SECRET?.trim();
  if (!username || !/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(passwordHash ?? '') || !sessionSecret || sessionSecret.length < 32) return null;
  return { username, passwordHash: passwordHash!, sessionSecret, version: createHash('sha256').update(`${username}:${passwordHash}`).digest('hex') };
}

export function derivePassword(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64, { N: 65536, r: 8, p: 2, maxmem: 128 * 1024 * 1024 }, (err, key) => err ? reject(err) : resolve(key)));
}

export async function verifyPassword(password: string, stored: string) {
  const [, salt, hash] = stored.split(':');
  const actual = await derivePassword(password, salt);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function adminSession(req: Req, res: ServerResponse) {
  const config = adminConfig();
  if (!config) throw new Error('Admin sign-in is not configured');
  return getIronSession<AdminSession>(req, res, {
    cookieName: process.env.VERCEL ? '__Host-fhn-admin' : 'fhn-admin',
    password: config.sessionSecret,
    ttl: SESSION_SECONDS,
    cookieOptions: { httpOnly: true, sameSite: 'strict', secure: !!process.env.VERCEL || process.env.NODE_ENV === 'production', path: '/', maxAge: SESSION_SECONDS },
  });
}

export function isAdmin(session: AdminSession, req: Req) {
  const config = adminConfig();
  return !!config && !!session.tabHash && session.tabHash === tabHash(req) && session.username === config.username && session.credentialVersion === config.version && typeof session.expiresAt === 'number' && session.expiresAt > Date.now();
}

/** JSON mutations must originate on this exact host. Cookies alone are not a CSRF check. */
export function sameOrigin(req: Req) {
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return false;
  try {
    const origin = new URL(String(req.headers?.origin ?? ''));
    return origin.host === req.headers.host && (origin.protocol === 'https:' || (!process.env.VERCEL && origin.protocol === 'http:'));
  } catch { return false; }
}

/** Shared by Vercel handlers and the local Express server; missing configuration fails closed. */
export async function requireAdmin(req: Req, res: ServerResponse): Promise<IronSession<AdminSession> | null> {
  if (!adminConfig()) {
    send(res, 503, { ok: false, message: 'Admin sign-in is being configured. Please try again shortly.' });
    return null;
  }
  const session = await adminSession(req, res);
  if (!isAdmin(session, req)) {
    send(res, 401, { ok: false, code: 'ADMIN_SESSION_REQUIRED', message: 'Please sign in to the hotel view.' });
    return null;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) {
    send(res, 403, { ok: false, message: 'Open the hotel view to make this change.' });
    return null;
  }
  return session;
}

// A bounded per-instance throttle. Production edge rate limits can add a global limit without
// changing the login flow; this does not claim to be shared across serverless instances.
const attempts = new Map<string, { n: number; until: number }>();
export function loginLimit(req: Req): number {
  const now = Date.now();
  for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
  const address = process.env.VERCEL ? String(req.headers?.['x-forwarded-for'] ?? '').split(',')[0] : req.socket?.remoteAddress ?? 'local';
  const key = createHash('sha256').update(address).digest('hex');
  if (attempts.size >= 1000 && !attempts.has(key)) return 60;
  const entry = attempts.get(key) ?? { n: 0, until: now + 10 * 60_000 };
  attempts.set(key, entry);
  if (++entry.n > 10) return Math.ceil((entry.until - now) / 1000);
  return 0;
}
