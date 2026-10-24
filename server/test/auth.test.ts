import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler, { checkLogin, issueSession, verifySession } from '../../api/auth.js';

const call = async (body: object) => {
  const res = { statusCode: 0, body: '', setHeader: () => undefined, end(s: string) { this.body = s; } };
  await handler({ method: 'POST', body } as never, res as never);
  return { status: res.statusCode, data: JSON.parse(res.body) as { ok: boolean; token?: string; user?: string } };
};

describe('staff sign-in', () => {
  beforeEach(() => {
    vi.stubEnv('ADMIN_USERNAME', 'frontdesk');
    vi.stubEnv('ADMIN_PASSWORD', 'p$$w0rd');
    vi.stubEnv('SESSION_SECRET', 'test-secret');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('accepts only the configured username and password', () => {
    expect(checkLogin('frontdesk', 'p$$w0rd')).toBe(true);
    expect(checkLogin(' frontdesk ', 'p$$w0rd')).toBe(true);
    expect(checkLogin('frontdesk', 'p$$w0rd ')).toBe(false);
    expect(checkLogin('someone', 'p$$w0rd')).toBe(false);
    expect(checkLogin('frontdesk', '')).toBe(false);
  });

  it('signs sessions, rejects tampered ones, and expires them', () => {
    vi.useFakeTimers();
    const token = issueSession('frontdesk');
    expect(verifySession(token)).toEqual({ u: 'frontdesk' });
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ u: 'frontdesk', exp: Date.now() + 1e12 })).toString('base64url');
    expect(verifySession(`${forged}.${sig}`)).toBeNull();
    expect(verifySession(`${body}.x${sig}`)).toBeNull();
    vi.advanceTimersByTime(13 * 3600_000);
    expect(verifySession(token)).toBeNull();
  });

  it('answers sign-in requests', async () => {
    expect((await call({ action: 'login', username: 'frontdesk', password: 'nope' })).status).toBe(401);
    const ok = await call({ action: 'login', username: 'frontdesk', password: 'p$$w0rd' });
    expect(ok.status).toBe(200);
    expect((await call({ action: 'session', token: ok.data.token })).data.user).toBe('frontdesk');
    expect((await call({ action: 'session', token: 'bad.token' })).status).toBe(401);
  });

  it('refuses sign-in when no credentials are configured', async () => {
    vi.stubEnv('ADMIN_USERNAME', '');
    expect((await call({ action: 'login', username: '', password: '' })).status).toBe(503);
  });
});
