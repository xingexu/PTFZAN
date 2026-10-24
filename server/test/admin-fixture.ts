import { randomBytes } from 'node:crypto';
import { vi } from 'vitest';
import auth from '../../api/auth.js';
import { derivePassword } from '../../api/_lib/admin-auth.js';
import type { Req } from '../../api/_lib/http.js';
import type { ServerResponse } from 'node:http';

export const testUsername = 'test-admin';
export const testPassword = 'test-only-password';
export async function configureTestAdmin() {
  const salt = randomBytes(16).toString('hex');
  const hash = await derivePassword(testPassword, salt);
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('ADMIN_USERNAME', testUsername);
  vi.stubEnv('ADMIN_PASSWORD_HASH', `scrypt:${salt}:${hash.toString('hex')}`);
  vi.stubEnv('ADMIN_SESSION_SECRET', randomBytes(48).toString('hex'));
}

export function mockResponse() {
  const headers = new Map<string, string | string[]>();
  return { statusCode: 200, headersSent: false, body: '', getHeader: (name: string) => headers.get(name.toLowerCase()), setHeader: (name: string, value: string | string[]) => headers.set(name.toLowerCase(), value), end(s: string) { this.body = s; this.headersSent = true; } };
}
let sequence = 0;
export function mockRequest(method: string, url: string, body?: object, cookie = '', extra: Record<string, string> = {}, ip = `test-${++sequence}`): Req {
  return { method, url, body, headers: { host: 'hotel.test', origin: 'http://hotel.test', 'content-type': 'application/json', cookie, ...extra }, socket: { remoteAddress: ip } } as Req;
}
export async function testLogin() {
  const res = mockResponse();
  await auth(mockRequest('POST', '/api/auth', { action: 'login', username: testUsername, password: testPassword }), res as unknown as ServerResponse);
  if (res.statusCode !== 200) throw new Error('Test login failed');
  const value = res.getHeader('set-cookie');
  return (Array.isArray(value) ? value[0] : value ?? '').split(';')[0];
}
