import { loadMessagingConfig, PUBLIC_URL, STAGE } from './env.js'; // loads .env first
import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GuestView, Mode } from '../../shared/types.js';
import { Simulation } from './engine.js';
import { Messenger } from './messaging.js';
import { maskPhone, normalizePhone } from './phone.js';
import { Stage, STAGE_CODE } from './stage.js';

const PORT = Number(process.env.PORT ?? 8787);
const MAX_DEMO_GUESTS = 150;

const sim = new Simulation('readypath');
const messenger = new Messenger(loadMessagingConfig(), () => broadcast());
const stage = new Stage(messenger, STAGE, () => broadcast());

/** Real phone numbers live only here — never in state that is sent to browsers. */
const phoneBook = new Map<string, string>();

sim.onNotify = (n, g, smsText) => {
  const to = phoneBook.get(g.code);
  if (!to) return; // simulated guests: their "texts" stay on screen
  messenger.send({ guestCode: g.code, notificationId: n.id, kind: n.kind, to, title: n.title, body: smsText, audience: 'guest' });
};

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '10kb' }));

const originOf = (req: Request) => PUBLIC_URL ?? `${req.protocol}://${req.get('host')}`;

// ───────────── Server-Sent Events ─────────────
const staffClients = new Set<Response>();
const stageClients = new Set<Response>();
const guestClients = new Map<Response, string>();

function sse(res: Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
}

function viewFor(code: string): GuestView | null {
  if (code.toUpperCase() === STAGE_CODE) return stage.guestView();
  const v = sim.guestView(code);
  if (!v) return null;
  for (const r of messenger.records) {
    if (r.guestCode === v.guest.code && r.notificationId && !v.delivery[r.notificationId]) {
      v.delivery[r.notificationId] = { status: r.status, provider: r.provider, error: r.error };
    }
  }
  return v;
}

let broadcastQueued = false;
function broadcast() {
  if (broadcastQueued) return;
  broadcastQueued = true;
  setImmediate(() => {
    broadcastQueued = false;
    const payload = `data: ${JSON.stringify(sim.state)}\n\n`;
    for (const res of staffClients) res.write(payload);
    if (stageClients.size) {
      const sp = `data: ${JSON.stringify(stage.state())}\n\n`;
      for (const res of stageClients) res.write(sp);
    }
    for (const [res, code] of guestClients) res.write(`data: ${JSON.stringify(viewFor(code))}\n\n`);
  });
}

// Keep proxies from closing idle streams; refresh the stage clock once a minute.
setInterval(() => {
  for (const res of [...staffClients, ...stageClients, ...guestClients.keys()]) res.write(': ping\n\n');
}, 15000).unref();
setInterval(() => stageClients.size && broadcast(), 30000).unref();

// ───────────── Playback loop ─────────────
let carry = 0;
const FRAME_MS = 100;
setInterval(() => {
  const s = sim.state;
  if (!s.playing || s.finished) return;
  carry += (s.speed * FRAME_MS) / 1000;
  let moved = false;
  while (carry >= 1) {
    carry -= 1;
    if (!sim.tick()) {
      carry = 0;
      break;
    }
    moved = true;
  }
  if (moved || !s.playing) broadcast();
}, FRAME_MS).unref();

// ───────────── API helpers ─────────────
const ok = (res: Response, extra: object = {}) => {
  broadcast();
  res.json({ ok: true, ...extra });
};
const bad = (res: Response, status: number, message: string) => res.status(status).json({ ok: false, message });

/** Stage controls trigger real texts, so they can be locked with STAGE_PIN on a public deployment. */
const stagePin = (req: Request, res: Response, next: NextFunction) =>
  stage.checkPin(req.get('x-stage-pin') ?? undefined) ? next() : bad(res, 401, 'Stage PIN required');

// ───────────── Simulation API ─────────────
app.get('/api/health', (_req, res) => res.json({ ok: true, now: sim.state.now, mode: sim.state.mode, messaging: messenger.status.provider }));
app.get('/api/state', (_req, res) => res.json(sim.state));

app.get('/api/stream', (req: Request, res: Response) => {
  sse(res);
  staffClients.add(res);
  res.write(`data: ${JSON.stringify(sim.state)}\n\n`);
  req.on('close', () => staffClients.delete(res));
});

app.post('/api/sim/reset', (req, res) => {
  const mode: Mode = req.body?.mode === 'baseline' ? 'baseline' : 'readypath';
  sim.reset(mode, { speed: sim.state.speed, autoApprove: sim.state.autoApprove });
  carry = 0;
  ok(res);
});

app.post('/api/sim/play', (req, res) => {
  const s = sim.state;
  if (s.finished) return bad(res, 409, 'The shift has ended. Reset to replay.');
  if (sim.pendingProposal && req.body?.playing) return bad(res, 409, 'Approve or dismiss the pending plan first.');
  s.playing = !!req.body?.playing;
  if (s.playing) s.pausedReason = undefined;
  ok(res);
});

app.post('/api/sim/speed', (req, res) => {
  const speed = Number(req.body?.speed);
  if (![1, 2, 5, 10, 20, 40].includes(speed)) return bad(res, 400, 'Unsupported speed');
  sim.state.speed = speed;
  ok(res);
});

app.post('/api/sim/step', (req, res) => {
  const minutes = Math.min(120, Math.max(1, Number(req.body?.minutes) || 1));
  sim.step(minutes);
  ok(res);
});

app.post('/api/sim/next-event', (_req, res) => {
  sim.state.playing = false;
  sim.nextEvent();
  ok(res);
});

app.post('/api/sim/auto-approve', (req, res) => {
  sim.state.autoApprove = !!req.body?.value;
  if (sim.state.autoApprove && sim.pendingProposal) sim.approve(sim.pendingProposal.id);
  ok(res);
});

app.post('/api/proposals/:id/approve', (req, res) => (sim.approve(req.params.id) ? ok(res) : bad(res, 404, 'No pending plan with that id')));
app.post('/api/proposals/:id/dismiss', (req, res) => (sim.dismiss(req.params.id) ? ok(res) : bad(res, 404, 'No pending plan with that id')));

app.post('/api/rooms/:id/issue', (req, res) => {
  const issue = String(req.body?.issue ?? '').trim().slice(0, 60) || 'Maintenance issue';
  const r = sim.reportIssue(req.params.id, issue);
  return r.ok ? ok(res, { message: r.message }) : bad(res, 400, r.message);
});

// ───────────── Guests ─────────────
app.get('/api/messaging/status', (_req, res) => res.json(messenger.status));

app.post('/api/guests/demo', (req, res) => {
  const name = String(req.body?.name ?? '').replace(/[<>]/g, '').trim();
  if (!name) return bad(res, 400, 'Please enter a first name.');
  if (sim.state.guests.filter((g) => g.isDemoGuest).length >= MAX_DEMO_GUESTS) return bad(res, 429, 'The demo is full. Please use an existing code.');
  const rawPhone = String(req.body?.phone ?? '').trim();
  let phone: string | null = null;
  if (rawPhone) {
    if (!req.body?.consent) return bad(res, 400, 'Please tick the box to agree to receive texts, or leave the phone number empty.');
    phone = normalizePhone(rawPhone);
    if (!phone) return bad(res, 400, 'That doesn’t look like a valid mobile number.');
  }
  const code = Simulation.newDemoCode((c) => sim.state.guests.some((g) => g.code === c));
  if (phone) phoneBook.set(code, phone);
  const g = sim.addDemoGuest(name, { code, phoneMasked: phone ? maskPhone(phone) : undefined });
  ok(res, { code: g.code });
});

app.get('/api/guest/:code', (req, res) => {
  const v = viewFor(req.params.code);
  return v ? res.json(v) : bad(res, 404, 'We could not find that booking code');
});

app.get('/api/guest/:code/stream', (req, res) => {
  const v = viewFor(req.params.code);
  if (!v) return bad(res, 404, 'We could not find that booking code');
  sse(res);
  guestClients.set(res, req.params.code);
  res.write(`data: ${JSON.stringify(v)}\n\n`);
  req.on('close', () => guestClients.delete(res));
});

app.post('/api/guest/:code/prefs', (req, res) => {
  if (req.params.code.toUpperCase() === STAGE_CODE) return ok(res);
  return sim.setGuestPrefs(req.params.code, !!req.body?.notifyBrowser) ? ok(res) : bad(res, 404, 'Unknown code');
});

// ───────────── Stage mode ─────────────
app.get('/api/stage/state', (_req, res) => res.json(stage.state()));
app.get('/api/stage/stream', (req, res) => {
  sse(res);
  stageClients.add(res);
  res.write(`data: ${JSON.stringify(stage.state())}\n\n`);
  req.on('close', () => stageClients.delete(res));
});
app.post('/api/stage/pin', stagePin, (_req, res) => res.json({ ok: true }));
app.post('/api/stage/next', stagePin, (req, res) => {
  const r = stage.next(originOf(req));
  return r.ok ? ok(res, { message: r.message }) : bad(res, 409, r.message);
});
app.post('/api/stage/check-in', stagePin, (req, res) => {
  const r = stage.checkIn(originOf(req));
  return r.ok ? ok(res, { message: r.message }) : bad(res, 409, r.message);
});
app.post('/api/stage/ready', stagePin, (req, res) => {
  const r = stage.markReady(originOf(req));
  return r.ok ? ok(res, { message: r.message }) : bad(res, 409, r.message);
});
app.post('/api/stage/reset', stagePin, (_req, res) => {
  stage.reset();
  ok(res);
});
app.post('/api/stage/test', stagePin, (req, res) => ok(res, { message: stage.test(originOf(req)).message }));
app.post('/api/stage/config', stagePin, (req, res) => {
  const b = req.body ?? {};
  const r = stage.configure({
    name: typeof b.name === 'string' ? b.name : undefined,
    phone: typeof b.phone === 'string' ? b.phone : undefined,
    room: typeof b.room === 'string' ? b.room : undefined,
  });
  return r.ok ? ok(res, { message: r.message }) : bad(res, 400, r.message);
});
app.post('/api/stage/send-real', stagePin, (req, res) => {
  stage.setSendReal(!!req.body?.value);
  ok(res);
});

app.use('/api', (_req, res) => bad(res, 404, 'Not found'));

// ───────────── Static client (production) ─────────────
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../../dist');
if (existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.listen(PORT, () => {
  const m = messenger.status;
  console.log(`ReadyPath listening on http://localhost:${PORT}`);
  console.log(`Messaging: ${m.provider} — ${m.note}`);
  console.log(`Stage guest "${STAGE.name}" · room ${STAGE.room} · phone ${STAGE.phone ? maskPhone(normalizePhone(STAGE.phone)) || 'invalid' : 'not set'}${STAGE.pin ? ' · PIN on' : ''}`);
});
