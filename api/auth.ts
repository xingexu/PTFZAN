import type { ServerResponse } from 'node:http';
import { adminConfig, adminSession, isAdmin, loginLimit, sameOrigin, SESSION_SECONDS, verifyPassword } from './_lib/admin-auth.js';
import { readBody, send, type Req } from './_lib/http.js';

export default async function auth(req: Req, res: ServerResponse) {
  try {
    const config = adminConfig();
    if (!config) return send(res, 503, { ok: false, message: 'Admin sign-in is being configured. Please try again shortly.' });
    const session = await adminSession(req, res);
    if (req.method === 'GET') return send(res, 200, { ok: true, authenticated: isAdmin(session), username: isAdmin(session) ? session.username : undefined });
    if (req.method !== 'POST') return send(res, 405, { ok: false, message: 'Use GET or POST' });
    if (!sameOrigin(req)) return send(res, 403, { ok: false, message: 'Please sign in from the hotel website.' });
    if (!String(req.headers['content-type']).startsWith('application/json')) return send(res, 415, { ok: false, message: 'Use JSON' });
    let body: Record<string, unknown>;
    try { body = await readBody(req); } catch { return send(res, 400, { ok: false, message: 'Please check your sign-in details.' }); }
    if (body.action === 'logout') {
      session.destroy();
      return send(res, 200, { ok: true, authenticated: false });
    }
    if (body.action !== 'login') return send(res, 400, { ok: false, message: 'Unknown action' });
    const retry = loginLimit(req);
    if (retry) {
      res.setHeader('Retry-After', retry);
      return send(res, 429, { ok: false, message: 'Too many attempts. Please try again in a few minutes.' });
    }
    if (typeof body.username !== 'string' || typeof body.password !== 'string' || body.username.length > 80 || body.password.length > 256) return send(res, 400, { ok: false, message: 'Enter your username and password.' });
    // Run the same password check for unknown usernames too.
    const valid = await verifyPassword(body.password, config.passwordHash);
    if (!valid || body.username.trim() !== config.username) return send(res, 401, { ok: false, message: 'The username or password is incorrect.' });
    session.username = config.username;
    session.credentialVersion = config.version;
    session.expiresAt = Date.now() + SESSION_SECONDS * 1000;
    await session.save();
    return send(res, 200, { ok: true, authenticated: true });
  } catch {
    return send(res, 503, { ok: false, message: 'Sign-in is unavailable for a moment. Please try again.' });
  }
}
