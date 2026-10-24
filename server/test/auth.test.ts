import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ServerResponse } from 'node:http';
import auth from '../../api/auth.js';
import hotel from '../../api/hotel.js';
import activity from '../../api/activity.js';
import { SESSION_SECONDS } from '../../api/_lib/admin-auth.js';
import { configureTestAdmin, mockRequest, mockResponse, testLogin, testPassword, testUsername } from './admin-fixture.js';

beforeAll(configureTestAdmin);
const call = async (handler: typeof hotel, method: string, url: string, body?: object, cookie = '', extra: Record<string, string> = {}, ip?: string) => {
  const res = mockResponse();
  await handler(mockRequest(method, url, body, cookie, extra, ip), res as unknown as ServerResponse);
  return { status: res.statusCode, data: JSON.parse(res.body), cookie: res.getHeader('set-cookie'), retry: res.getHeader('retry-after') };
};

describe('admin access', () => {
  it('protects hotel data and controls while reporting a signed-out session', async () => {
    expect((await call(auth, 'GET', '/api/auth')).data.authenticated).toBe(false);
    const blocked = await call(hotel, 'GET', '/api/hotel');
    expect(blocked.status).toBe(401);
    expect(blocked.data.code).toBe('ADMIN_SESSION_REQUIRED');
    expect((await call(hotel, 'POST', '/api/hotel', { action: 'reset' })).status).toBe(401);
    expect((await call(activity, 'GET', '/api/activity')).status).toBe(401);
  });
  it('rejects wrong credentials with one generic error', async () => {
    const badPassword = await call(auth, 'POST', '/api/auth', { action: 'login', username: testUsername, password: 'incorrect' });
    const badUser = await call(auth, 'POST', '/api/auth', { action: 'login', username: 'someone-else', password: testPassword });
    expect(badPassword.status).toBe(401);
    expect(badUser.data).toEqual(badPassword.data);
    expect(badPassword.cookie).toBeUndefined();
  });
  it('creates a sealed HttpOnly session and allows protected reads', async () => {
    const reply = await call(auth, 'POST', '/api/auth', { action: 'login', username: testUsername, password: testPassword });
    expect(reply.status).toBe(200);
    expect(String(reply.cookie)).toContain('HttpOnly');
    expect(String(reply.cookie)).toContain('SameSite=Strict');
    expect(String(reply.cookie)).not.toContain(testPassword);
    const cookie = await testLogin();
    expect((await call(auth, 'GET', '/api/auth', undefined, cookie)).data.authenticated).toBe(true);
    expect((await call(hotel, 'GET', '/api/hotel', undefined, cookie)).status).toBe(200);
    expect((await call(activity, 'GET', '/api/activity', undefined, cookie)).status).toBe(200);
  });
  it('uses a Secure, host-only cookie on Vercel', async () => {
    vi.stubEnv('VERCEL', '1');
    try {
      const reply = await call(auth, 'POST', '/api/auth', { action: 'login', username: testUsername, password: testPassword }, '', { origin: 'https://hotel.test' });
      expect(reply.status).toBe(200);
      expect(String(reply.cookie)).toContain('__Host-fhn-admin=');
      expect(String(reply.cookie)).toContain('Secure');
      expect(String(reply.cookie)).toContain('Path=/');
    } finally { vi.stubEnv('VERCEL', ''); }
  });
  it('starts a fresh tab signed out even when the browser still has a cookie', async () => {
    const cookie = await testLogin();
    const fresh = { 'x-fhn-session': '' };
    expect((await call(auth, 'GET', '/api/auth', undefined, cookie, fresh)).data.authenticated).toBe(false);
    expect((await call(hotel, 'GET', '/api/hotel', undefined, cookie, fresh)).status).toBe(401);
    expect((await call(hotel, 'GET', '/api/hotel', undefined, cookie, { 'x-fhn-session': 'b'.repeat(64) })).status).toBe(401);
    expect((await call(hotel, 'GET', '/api/hotel', undefined, cookie)).status).toBe(200);
  });
  it('requires a tab key when creating an admin session', async () => {
    const result = await call(auth, 'POST', '/api/auth', { action: 'login', username: testUsername, password: testPassword }, '', { 'x-fhn-session': '' });
    expect(result.status).toBe(400);
    expect(result.cookie).toBeUndefined();
  });
  it('rejects cross-origin sign-in, sign-out and hotel mutations', async () => {
    const cookie = await testLogin();
    const origin = { origin: 'https://unrelated.test' };
    expect((await call(auth, 'POST', '/api/auth', { action: 'login', username: testUsername, password: testPassword }, '', origin)).status).toBe(403);
    expect((await call(auth, 'POST', '/api/auth', { action: 'logout' }, cookie, origin)).status).toBe(403);
    expect((await call(hotel, 'POST', '/api/hotel', { action: 'reset' }, cookie, origin)).status).toBe(403);
  });
  it('rejects tampered and expired sessions', async () => {
    const cookie = await testLogin();
    expect((await call(hotel, 'GET', '/api/hotel', undefined, cookie.replace('=', '=tampered'))).status).toBe(401);
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + (SESSION_SECONDS + 1) * 1000);
    try { expect((await call(hotel, 'GET', '/api/hotel', undefined, cookie)).status).toBe(401); }
    finally { clock.mockRestore(); }
  });
  it('clears the browser session on logout and rejects requests without it', async () => {
    const cookie = await testLogin();
    const reply = await call(auth, 'POST', '/api/auth', { action: 'logout' }, cookie);
    expect(reply.data.authenticated).toBe(false);
    expect(String(reply.cookie)).toContain('Max-Age=0');
    expect((await call(hotel, 'GET', '/api/hotel')).status).toBe(401);
  });
  it('throttles repeated login attempts on this server instance', async () => {
    for (let i = 0; i < 10; i++) await call(auth, 'POST', '/api/auth', { action: 'login', username: testUsername, password: 'incorrect' }, '', {}, 'throttle-test');
    const reply = await call(auth, 'POST', '/api/auth', { action: 'login', username: testUsername, password: testPassword }, '', {}, 'throttle-test');
    expect(reply.status).toBe(429);
    expect(Number(reply.retry)).toBeGreaterThan(0);
  });
  it('fails closed when admin secrets are absent', async () => {
    const secret = process.env.ADMIN_SESSION_SECRET!;
    vi.stubEnv('ADMIN_SESSION_SECRET', '');
    try {
      expect((await call(auth, 'GET', '/api/auth')).status).toBe(503);
      expect((await call(hotel, 'GET', '/api/hotel')).status).toBe(503);
    } finally { vi.stubEnv('ADMIN_SESSION_SECRET', secret); }
  });
});
