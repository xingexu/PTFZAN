import { loadMessagingConfig, PUBLIC_URL, STAGE } from './env.js'; // loads .env first
import express, { type NextFunction, type Request, type Response } from 'express';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GuestView, HousekeepingPref, Mode, SimState } from '../../shared/types.js';
import { DEMO_HOLD_MS, demoSpeedAt } from './demo.js';
import { Simulation } from './engine.js';
import { Messenger } from './messaging.js';
import { maskPhone, normalizePhone } from './phone.js';
import { Stage, STAGE_CODE } from './stage.js';

const PORT = Number(process.env.PORT ?? 8787);
const MAX_DEMO_GUESTS = 150;

const SPEEDS = [5, 10, 20, 30, 60];

const sim = new Simulation('ai');
/** The same day replayed in the other mode, in lockstep — every screen can show "today vs with FHN AI". */
const shadow = new Simulation('baseline');
shadow.state.autoApprove = true;

function resetBoth(mode: Mode) {
  sim.reset(mode, { speed: sim.state.speed, autoApprove: sim.state.autoApprove });
  shadow.reset(mode === 'ai' ? 'baseline' : 'ai', { autoApprove: true });
  carry = 0;
  holdSince = 0;
}

/** Bring the shadow run to the same minute as the main run. */
function syncShadow() {
  while (!shadow.state.finished && (shadow.state.now < sim.state.now || sim.state.finished)) {
    if (!shadow.tick()) break;
  }
}

const snapshot = (): SimState => ({
  ...sim.state,
  compare: { mode: shadow.state.mode, now: shadow.state.now, metrics: shadow.state.metrics },
  guestsOnline: new Set(guestClients.values()).size,
});
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
    const payload = `data: ${JSON.stringify(snapshot())}\n\n`;
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
/** Autopilot: when the pending plan appeared (epoch ms). */
let holdSince = 0;
const FRAME_MS = 100;
setInterval(() => {
  const s = sim.state;
  if (s.autopilot && !s.finished) {
    const p = sim.pendingProposal;
    if (p) {
      // Leave the approval card on screen for a beat, then the supervisor approves.
      if (!holdSince) holdSince = Date.now();
      else if (Date.now() - holdSince >= DEMO_HOLD_MS) {
        holdSince = 0;
        sim.approve(p.id);
        s.playing = true;
        broadcast();
      }
      return;
    }
    s.speed = demoSpeedAt(s.now);
  }
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
  syncShadow();
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
app.get('/api/state', (_req, res) => res.json(snapshot()));

app.get('/api/stream', (req: Request, res: Response) => {
  sse(res);
  staffClients.add(res);
  res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
  req.on('close', () => staffClients.delete(res));
});

/** Any manual control hands playback back to the presenter. */
const manual = () => {
  if (sim.state.autopilot) sim.state.speed = 20;
  sim.state.autopilot = false;
  holdSince = 0;
};

app.post('/api/sim/reset', (req, res) => {
  manual();
  resetBoth(req.body?.mode === 'baseline' ? 'baseline' : 'ai');
  ok(res);
});

/** The 30-second demo: replay the whole shift with FHN AI, hands-free. */
app.post('/api/sim/demo', (_req, res) => {
  resetBoth('ai');
  sim.state.autopilot = true;
  sim.state.speed = demoSpeedAt(sim.state.now);
  sim.state.playing = true;
  ok(res);
});

app.post('/api/sim/play', (req, res) => {
  const s = sim.state;
  if (s.finished) return bad(res, 409, 'The shift has ended. Reset to replay.');
  if (sim.pendingProposal && req.body?.playing) return bad(res, 409, 'Approve or dismiss the pending plan first.');
  manual();
  s.playing = !!req.body?.playing;
  if (s.playing) s.pausedReason = undefined;
  ok(res);
});

app.post('/api/sim/speed', (req, res) => {
  const speed = Number(req.body?.speed);
  if (!SPEEDS.includes(speed)) return bad(res, 400, 'Unsupported speed');
  manual();
  sim.state.speed = speed;
  ok(res);
});

app.post('/api/sim/step', (req, res) => {
  manual();
  const minutes = Math.min(120, Math.max(1, Number(req.body?.minutes) || 1));
  sim.step(minutes);
  syncShadow();
  ok(res);
});

app.post('/api/sim/next-event', (_req, res) => {
  manual();
  sim.state.playing = false;
  sim.nextEvent();
  syncShadow();
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
  const g = sim.addDemoGuest(name, { code, phoneMasked: phone ? maskPhone(phone) : undefined, checkIn: req.body?.checkIn !== false });
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
  broadcast(); // the hotel view shows how many guests are connected
  req.on('close', () => {
    guestClients.delete(res);
    broadcast();
  });
});

app.post('/api/guest/:code/prefs', (req, res) => {
  if (req.params.code.toUpperCase() === STAGE_CODE) return ok(res);
  return sim.setGuestPrefs(req.params.code, !!req.body?.notifyBrowser) ? ok(res) : bad(res, 404, 'Unknown code');
});

// Guest app actions. The stage guest is scripted, so its app is read-only.
type GuestAction = (code: string, body: Record<string, unknown>) => { ok: boolean; message: string };
const guestAction = (fn: GuestAction) => (req: Request, res: Response) => {
  if (req.params.code.toUpperCase() === STAGE_CODE) return bad(res, 409, 'The stage guest is controlled from /stage.');
  const r = fn(req.params.code, req.body ?? {});
  return r.ok ? ok(res, { message: r.message }) : bad(res, 400, r.message);
};
const text = (v: unknown, max = 40) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, max);
const HOUSEKEEPING: HousekeepingPref[] = ['standard', 'green', 'dnd'];

app.post('/api/guest/:code/check-in', guestAction((code) => sim.checkInOnline(code)));
app.post('/api/guest/:code/issue', guestAction((code, b) => sim.guestReportIssue(code, text(b.issue) || 'Something is not working')));
app.post('/api/guest/:code/request', guestAction((code, b) => sim.guestRequestItem(code, text(b.item) || 'Extra towels')));
app.post(
  '/api/guest/:code/climate',
  guestAction((code, b) =>
    sim.guestClimate(code, {
      setpoint: typeof b.setpoint === 'number' ? b.setpoint : undefined,
      awayMinutes: b.awayMinutes === null ? null : typeof b.awayMinutes === 'number' ? b.awayMinutes : undefined,
    }),
  ),
);
app.post(
  '/api/guest/:code/housekeeping',
  guestAction((code, b) => (HOUSEKEEPING.includes(b.pref as HousekeepingPref) ? sim.guestHousekeeping(code, b.pref as HousekeepingPref) : { ok: false, message: 'Unknown preference' })),
);

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

// ───────────── Two views: hotel (staff) and guest ─────────────
// Locally the hotel view runs on PORT and the guest app on PORT+1, so each opens in its own tab
// (same server, same live data). On a single public URL both live side by side under one origin.
const GUEST_PORT = Number(process.env.GUEST_PORT ?? PORT + 1);
let guestListening = false;

/** IPv4 addresses phones on the same Wi-Fi can reach. */
const lanHosts = () =>
  Object.values(networkInterfaces())
    .flat()
    .filter((n): n is NonNullable<typeof n> => !!n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);

interface ViewLinks {
  /** Which view this tab is: decides the routes the client shows. */
  view: 'hotel' | 'guest';
  hotel: string;
  guest: string;
  /** What the QR code points at — a Wi-Fi address when the presenter is on localhost. */
  guestQr: string;
}

function linksFor(req: Request): ViewLinks {
  const host = req.get('host') ?? '';
  const named = host.match(/^(.+):(\d+)$/);
  if (PUBLIC_URL || !named || !guestListening) {
    const origin = originOf(req);
    return { view: 'hotel', hotel: origin, guest: origin, guestQr: origin };
  }
  const name = named[1];
  const at = (port: number) => `${req.protocol}://${name}:${port}`;
  const local = name === 'localhost' || name === '127.0.0.1';
  const lan = lanHosts()[0];
  return {
    view: req.socket.localPort === GUEST_PORT ? 'guest' : 'hotel',
    hotel: at(PORT),
    guest: at(GUEST_PORT),
    guestQr: local && lan ? `http://${lan}:${GUEST_PORT}` : at(GUEST_PORT),
  };
}

// ───────────── Static client (production) ─────────────
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../../dist');
const indexFile = path.join(dist, 'index.html');
if (existsSync(indexFile)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (req, res) => {
    // Tell the page which view it is and where the other view lives.
    const links = linksFor(req);
    const html = readFileSync(indexFile, 'utf8').replace('</head>', `<script>window.__FHN__=${JSON.stringify(links)}</script></head>`);
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(html);
  });
} else {
  // API only (e.g. `npm run dev`, where Vite serves the UI on :5173). Explain instead of a bare "Cannot GET /".
  app.get('*', (_req, res) =>
    res
      .status(503)
      .type('html')
      .send(
        '<!doctype html><meta charset="utf-8"><title>FHN</title>' +
          '<body style="font-family:system-ui;padding:40px;max-width:640px;line-height:1.5">' +
          '<h1>The FHN server is running</h1><p>The web app hasn’t been built yet. Run <code>npm run build</code>, then restart ' +
          '<code>npm start</code> — or use <code>npm run dev</code> and open <a href="http://localhost:5173">localhost:5173</a>.</p></body>',
      ),
  );
}

/** Opens both views in the default browser (`npm run demo`). */
function openTabs(urls: string[]) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  for (const u of urls) execFile(cmd, process.platform === 'win32' ? ['/c', 'start', '', u] : [u], () => undefined);
}

const portBusy = (port: number) =>
  `\nPort ${port} is already in use (another copy of the FHN server or another dev server).\nStop it, or start on different ports:  PORT=8790 npm start\n`;

const server = app.listen(PORT, () => {
  const guest = app.listen(GUEST_PORT, () => {
    guestListening = true;
    const m = messenger.status;
    console.log(`\nFHN is running`);
    console.log(`  Hotel view (staff):  http://localhost:${PORT}`);
    console.log(`  Guest view (app):    http://localhost:${GUEST_PORT}`);
    for (const h of lanHosts()) console.log(`  phones on the same Wi-Fi: guest app http://${h}:${GUEST_PORT} · stage remote http://${h}:${PORT}/stage/remote`);
    console.log(`Messaging: ${m.provider} — ${m.note}`);
    console.log(`Stage guest "${STAGE.name}" · room ${STAGE.room} · phone ${STAGE.phone ? maskPhone(normalizePhone(STAGE.phone)) || 'invalid' : 'not set'}${STAGE.pin ? ' · PIN on' : ''}`);
    console.log('Press Ctrl+C to stop.\n');
    if (process.argv.includes('--open')) openTabs([`http://localhost:${PORT}`, `http://localhost:${GUEST_PORT}`]);
  });
  guest.on('error', (e: NodeJS.ErrnoException) => {
    // Still usable on one port: the guest app lives at /join and /app.
    console.warn(e.code === 'EADDRINUSE' ? portBusy(GUEST_PORT) : String(e));
    console.log(`Hotel view: http://localhost:${PORT} · guest app on the same port at /join`);
  });
});

server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    console.error(portBusy(PORT));
    process.exit(1);
  }
  throw e;
});
