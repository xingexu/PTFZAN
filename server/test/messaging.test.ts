import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MessagingConfig } from '../src/env.js';
import { Messenger } from '../src/messaging.js';
import type { DeliveryRecord } from '../../shared/types.js';
import { maskPhone, normalizePhone, smsSegments, toSmsText } from '../src/phone.js';
import { Stage } from '../src/stage.js';

// ───────────── Mock Twilio + ntfy server ─────────────
interface Captured {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}
const captured: Captured[] = [];
let server: Server;
let base = '';
const polls: Record<string, number> = {};

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      captured.push({ method: req.method!, url: req.url!, headers: req.headers, body });
      const json = (code: number, obj: unknown) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (req.url?.startsWith('/ntfy/')) return json(200, { id: 'n1' });
      if (req.url === '/httpsms/v1/messages/send' && req.method === 'POST') {
        if (req.headers['x-api-key'] !== 'key123') return json(401, { message: 'Unauthorized' });
        const b = JSON.parse(body || '{}');
        if (b.from !== '+16475550188') return json(422, { message: 'from is not a registered phone' });
        return json(200, { data: { id: 'm1', status: 'pending' }, status: 'success' });
      }
      const create = req.url === '/2010-04-01/Accounts/AC123/Messages.json';
      if (create && req.method === 'POST') {
        const expected = 'Basic ' + Buffer.from('AC123:secret').toString('base64');
        if (req.headers.authorization !== expected) return json(401, { code: 20003, message: 'Authenticate' });
        const form = new URLSearchParams(body);
        if (form.get('To') === '+12045550000') return json(400, { code: 21608, message: 'unverified' });
        const sid = form.get('To') === '+12045550111' ? 'SMFAIL' : 'SMOK';
        polls[sid] = 0;
        return json(201, { sid, status: 'queued' });
      }
      const m = req.url?.match(/Messages\/(SM\w+)\.json$/);
      if (m && req.method === 'GET') {
        const n = ++polls[m[1]];
        if (m[1] === 'SMFAIL') return json(200, { status: n < 2 ? 'sent' : 'undelivered', error_code: n < 2 ? null : 30007 });
        return json(200, { status: n < 2 ? 'sent' : 'delivered' });
      }
      json(404, { message: 'not found' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const cfg = (over: Partial<MessagingConfig> = {}): MessagingConfig => ({
  twilio: { accountSid: 'AC123', authToken: 'secret', from: '+16475550199', apiBase: base },
  allowGuestTextsFromPersonalNumber: false,
  maxPerHour: 50,
  maxPerGuestPerHour: 5,
  pollIntervalMs: 10,
  pollTimeoutMs: 2000,
  ...over,
});

describe('phone helpers', () => {
  it('normalizes North American numbers to E.164', () => {
    expect(normalizePhone('416-555-0123')).toBe('+14165550123');
    expect(normalizePhone('(647) 555 0199')).toBe('+16475550199');
    expect(normalizePhone('+1 416 555 0123')).toBe('+14165550123');
    expect(normalizePhone('1-416-555-0123')).toBe('+14165550123');
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
  });
  it('rejects junk', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('016-555-0123')).toBeNull(); // area code can't start with 0
    expect(normalizePhone('416-155-0123')).toBeNull(); // exchange can't start with 1
  });
  it('masks numbers', () => {
    expect(maskPhone('+14165550123')).toBe('+1 (416) •••-0123');
    expect(maskPhone('+14165550123')).not.toContain('555');
  });
  it('keeps SMS text GSM-7 and single-segment', () => {
    const t = toSmsText('Room 504 — ready 2:35–2:50 PM. We’ll text you…');
    expect(t).toBe("Room 504 - ready 2:35-2:50 PM. We'll text you...");
    expect(smsSegments(t)).toBe(1);
    expect(smsSegments('x'.repeat(161))).toBe(2);
  });
});

describe('Twilio SMS', () => {
  it('sends with Basic auth and form fields, then tracks delivery', async () => {
    const updates: string[] = [];
    const m = new Messenger(cfg(), (r) => updates.push(r.status));
    const rec = m.send({ guestCode: 'MIKE', kind: 'ready', to: '+14165550123', title: 'Ready', body: 'FHN Toronto: Mike, room 504 is ready — welcome!', audience: 'stage' });
    expect(rec.provider).toBe('twilio');
    expect(rec.toMasked).toBe('+1 (416) •••-0123');
    const done = await m.settle(rec.id);
    expect(done.status).toBe('delivered');
    expect(done.latencyMs).toBeGreaterThanOrEqual(0);
    expect(updates).toContain('sent');
    const post = captured.find((c) => c.method === 'POST' && c.url.endsWith('/Messages.json'))!;
    const form = new URLSearchParams(post.body);
    expect(form.get('To')).toBe('+14165550123');
    expect(form.get('From')).toBe('+16475550199');
    expect(form.get('Body')).toBe('FHN Toronto: Mike, room 504 is ready - welcome!'); // en dash converted
    expect(post.headers['content-type']).toContain('application/x-www-form-urlencoded');
  });

  it('explains common Twilio errors in plain language', async () => {
    const m = new Messenger(cfg());
    const rec = m.send({ guestCode: 'G1', kind: 'ready', to: '+12045550000', title: 't', body: 'b', audience: 'guest' });
    const done = await m.settle(rec.id);
    expect(done.status).toBe('failed');
    expect(done.error).toMatch(/verified/);
    expect(done.error).toMatch(/21608/);
  });

  it('reports carrier filtering when a message is undelivered', async () => {
    const m = new Messenger(cfg());
    const rec = m.send({ guestCode: 'G2', kind: 'eta', to: '+12045550111', title: 't', body: 'b', audience: 'guest' });
    const done = await m.settle(rec.id);
    expect(done.status).toBe('undelivered');
    expect(done.error).toMatch(/spam/);
  });

  it('uses only To + Body in trial-template mode', async () => {
    const m = new Messenger(cfg({ twilio: { accountSid: 'AC123', authToken: 'secret', trialTemplate: 'sms_appointment_reminders', apiBase: base } }));
    expect(m.status.trialTemplate).toBe('sms_appointment_reminders');
    const before = captured.length;
    const rec = m.send({ guestCode: 'G3', kind: 'ready', to: '+14165550123', title: 't', body: 'custom', audience: 'guest' });
    await m.settle(rec.id);
    const post = captured.slice(before).find((c) => c.method === 'POST')!;
    const form = new URLSearchParams(post.body);
    expect(form.get('Body')).toBe('sms_appointment_reminders');
    expect(form.has('From')).toBe(false);
  });

  it('enforces per-guest and hourly caps to protect SMS credit', async () => {
    const m = new Messenger(cfg({ maxPerGuestPerHour: 2, maxPerHour: 3 }));
    const send = (g: string) => m.send({ guestCode: g, kind: 'eta', to: '+14165550123', title: 't', body: 'b', audience: 'guest' });
    send('A');
    send('A');
    const third = send('A');
    expect(third.status).toBe('failed');
    expect(third.error).toMatch(/per guest/);
    send('B');
    const fifth = send('C');
    expect(fifth.error).toMatch(/Hourly limit/);
  });

  it('never sends a demo guest’s text to the presenter’s push topic', () => {
    const m = new Messenger(cfg({ twilio: undefined, ntfy: { server: `${base}/ntfy`, topic: 't' } }));
    expect(m.resolve({ guestCode: 'G', kind: 'eta', title: '', body: '', audience: 'guest', to: '+14165550123' })).toBe('simulated');
    expect(m.resolve({ guestCode: 'MIKE', kind: 'eta', title: '', body: '', audience: 'stage' })).toBe('ntfy');
  });
});

describe('ntfy push fallback', () => {
  it('posts title, priority and click URL', async () => {
    const m = new Messenger(cfg({ twilio: undefined, ntfy: { server: `${base}/ntfy`, topic: 'fhn-demo-xyz' } }));
    expect(m.status.provider).toBe('ntfy');
    const before = captured.length;
    const rec = m.send({ guestCode: 'MIKE', kind: 'ready', title: 'Room 504 is ready', body: 'Mike, your room is ready!', clickUrl: 'https://x.test/guest/MIKE', audience: 'stage' });
    const done = await m.settle(rec.id);
    expect(done.status).toBe('sent');
    const c = captured.slice(before).find((x) => x.url === '/ntfy/fhn-demo-xyz')!;
    expect(c.headers.title).toBe('Room 504 is ready');
    expect(c.headers.priority).toBe('high');
    expect(c.headers.click).toBe('https://x.test/guest/MIKE');
    expect(c.body).toBe('Mike, your room is ready!');
  });
});

describe('Stage mode', () => {
  const make = (phone = '+14165550123', pin?: string) => {
    const m = new Messenger(cfg());
    return { m, stage: new Stage(m, { name: 'Mike', room: '504', phone, pin, timeZone: 'America/Toronto' }) };
  };

  it('check-in sends an ETA text, then ready sends the room-ready text', async () => {
    const { m, stage } = make();
    expect(stage.next().ok).toBe(true);
    let s = stage.state();
    expect(s.step).toBe('checked-in');
    expect(s.eta!.high - s.eta!.low).toBe(15);
    expect(s.messages[0].kind).toBe('eta');
    await m.settle(s.deliveries[0].id);
    expect(stage.state().deliveries[0].status).toBe('delivered');

    await new Promise((r) => setTimeout(r, 1600)); // debounce window
    expect(stage.next().ok).toBe(true);
    s = stage.state();
    expect(s.step).toBe('ready');
    expect(s.messages[0].body).toMatch(/room 504 is ready/);
    const sms = captured.filter((c) => c.method === 'POST' && c.body.includes('504+is+ready'));
    expect(sms.length).toBeGreaterThan(0);
    const v = stage.guestView();
    expect(v.room.status).toBe('ready');
    expect(Object.values(v.delivery).length).toBe(2);
  });

  it('ignores an accidental double press', () => {
    const { stage } = make();
    expect(stage.next().ok).toBe(true);
    const second = stage.next();
    expect(second.ok).toBe(false);
    expect(stage.state().step).toBe('checked-in');
  });

  it('rehearsal mode simulates instead of texting', () => {
    const { stage } = make();
    stage.setSendReal(false);
    stage.next();
    expect(stage.state().deliveries[0].provider).toBe('simulated');
  });

  it('validates configuration and PIN', () => {
    const { stage } = make(undefined, '2468');
    expect(stage.configure({ phone: 'abc' }).ok).toBe(false);
    expect(stage.configure({ room: '50' }).ok).toBe(false);
    expect(stage.configure({ phone: '647 555 0199', name: 'Mike' }).ok).toBe(true);
    expect(stage.state().phoneMasked).toBe('+1 (647) •••-0199');
    expect(stage.checkPin('2468')).toBe(true);
    expect(stage.checkPin('0000')).toBe(false);
    expect(stage.checkPin(undefined)).toBe(false);
    expect(JSON.stringify(stage.state())).not.toContain('5550199');
  });

  it('reset clears the scene for another rehearsal', () => {
    const { stage } = make();
    stage.next();
    stage.reset();
    const s = stage.state();
    expect(s.step).toBe('booked');
    expect(s.messages).toHaveLength(0);
  });
});

describe('sending from your own number', () => {
  const personal = (over: Partial<MessagingConfig> = {}) =>
    cfg({ twilio: undefined, httpsms: { apiKey: 'key123', from: '+16475550188', apiBase: `${base}/httpsms` }, ...over });

  it('Android (httpSMS): your phone sends it, with your number as sender', async () => {
    const m = new Messenger(personal());
    expect(m.status.provider).toBe('httpsms');
    expect(m.status.personalNumber).toBe(true);
    expect(m.status.sender).toBe('+1 (647) •••-0188');
    const before = captured.length;
    const rec = m.send({ guestCode: 'MIKE', kind: 'ready', to: '+14165550123', title: 't', body: 'FHN Toronto: Mike, your room 504 is ready — welcome!', audience: 'stage' });
    expect(rec.from).toBe('+1 (647) •••-0188');
    const done = await m.settle(rec.id);
    expect(done.status).toBe('sent');
    const c = captured.slice(before).find((x) => x.url === '/httpsms/v1/messages/send')!;
    expect(c.headers['x-api-key']).toBe('key123');
    expect(JSON.parse(c.body)).toEqual({ from: '+16475550188', to: '+14165550123', content: 'FHN Toronto: Mike, your room 504 is ready - welcome!' });
  });

  it('httpSMS errors are explained', async () => {
    const bad = new Messenger(personal({ httpsms: { apiKey: 'nope', from: '+16475550188', apiBase: `${base}/httpsms` } }));
    const r1 = await bad.settle(bad.send({ guestCode: 'MIKE', kind: 'ready', to: '+14165550123', title: 't', body: 'b', audience: 'stage' }).id);
    expect(r1.status).toBe('failed');
    expect(r1.error).toMatch(/API key/);
    const wrongFrom = new Messenger(personal({ httpsms: { apiKey: 'key123', from: '+15195550100', apiBase: `${base}/httpsms` } }));
    const r2 = await wrongFrom.settle(wrongFrom.send({ guestCode: 'MIKE', kind: 'ready', to: '+14165550123', title: 't', body: 'b', audience: 'stage' }).id);
    expect(r2.error).toMatch(/HTTPSMS_FROM/);
  });

  it('never texts audience guests from your personal number unless you allow it', () => {
    const msg = { guestCode: 'DEMOAB12', kind: 'eta' as const, to: '+14165550123', title: '', body: '', audience: 'guest' as const };
    expect(new Messenger(personal()).resolve(msg)).toBe('simulated');
    expect(new Messenger(personal()).status.smsEnabled).toBe(false);
    expect(new Messenger(personal({ allowGuestTextsFromPersonalNumber: true })).resolve(msg)).toBe('httpsms');
  });

  it('SMS_PROVIDER picks between configured providers', () => {
    const both = cfg({ httpsms: { apiKey: 'key123', from: '+16475550188', apiBase: `${base}/httpsms` }, preferred: 'httpsms' });
    const msg = { guestCode: 'MIKE', kind: 'ready' as const, to: '+14165550123', title: '', body: '', audience: 'stage' as const };
    expect(new Messenger(both).resolve(msg)).toBe('httpsms');
    expect(new Messenger({ ...both, preferred: undefined }).resolve(msg)).toBe('twilio');
  });

  describe('Mac Messages', () => {
    const macCfg = (service: 'imessage' | 'sms' = 'imessage') => cfg({ twilio: undefined, mac: { service } });
    const calls: { script: string; args: string[] }[] = [];
    const ok = async (script: string, args: string[]) => {
      calls.push({ script, args });
    };

    it('sends through the Messages app with arguments, not string interpolation', async () => {
      calls.length = 0;
      const m = new Messenger(macCfg('sms'), undefined, { platform: 'darwin', runAppleScript: ok });
      expect(m.status.provider).toBe('mac');
      const text = 'Room 504 is ready"; do shell script "rm -rf ~';
      const rec = m.send({ guestCode: 'MIKE', kind: 'ready', to: '+14165550123', title: 't', body: text, audience: 'stage' });
      const done = await m.settle(rec.id);
      expect(done.status).toBe('sent');
      expect(calls).toHaveLength(1);
      expect(calls[0].args).toEqual(['+14165550123', text, 'sms']);
      expect(calls[0].script).not.toContain('rm -rf');
      expect(calls[0].script).toContain('participant targetPhone');
    });

    it('falls back to the older Messages dictionary', async () => {
      calls.length = 0;
      let first = true;
      const flaky = async (script: string, args: string[]) => {
        calls.push({ script, args });
        if (first) {
          first = false;
          throw new Error("syntax error: Expected class name but found identifier. (-2741)");
        }
      };
      const m = new Messenger(macCfg(), undefined, { platform: 'darwin', runAppleScript: flaky });
      const done = await m.settle(m.send({ guestCode: 'MIKE', kind: 'ready', to: '+14165550123', title: 't', body: 'b', audience: 'stage' }).id);
      expect(done.status).toBe('sent');
      expect(calls[1].script).toContain('buddy targetPhone');
    });

    it('explains the macOS Automation permission prompt', async () => {
      const denied = async () => {
        throw new Error('execution error: Not authorized to send Apple events to Messages. (-1743)');
      };
      const m = new Messenger(macCfg(), undefined, { platform: 'darwin', runAppleScript: denied });
      const done: DeliveryRecord = await m.settle(m.send({ guestCode: 'MIKE', kind: 'ready', to: '+14165550123', title: 't', body: 'b', audience: 'stage' }).id);
      expect(done.status).toBe('failed');
      expect(done.error).toMatch(/Automation/);
    });

    it('refuses politely when the server is not on a Mac', async () => {
      const m = new Messenger(macCfg(), undefined, { platform: 'linux', runAppleScript: ok });
      expect(m.status.note).toMatch(/not running on a Mac/);
      const done = await m.settle(m.send({ guestCode: 'MIKE', kind: 'ready', to: '+14165550123', title: 't', body: 'b', audience: 'stage' }).id);
      expect(done.status).toBe('failed');
      expect(done.error).toMatch(/Mac/);
    });
  });
});
