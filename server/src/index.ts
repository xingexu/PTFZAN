import { loadMessagingConfig, PUBLIC_URL, STAGE } from './env.js'; // loads .env first
import express, { type NextFunction, type Request, type Response } from 'express';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import activityHandler from '../../api/activity.js';
import guestHandler from '../../api/guest.js';
import hotelHandler from '../../api/hotel.js';
import { store } from '../../api/_lib/store.js';
import { Messenger } from './messaging.js';
import { maskPhone, normalizePhone } from './phone.js';
import { Stage } from './stage.js';

// Locally this server hosts both views (the hotel day itself runs in the browser), the guest API,
// and the live text-message demo, which needs a long-running process to send real texts.
const PORT = Number(process.env.PORT ?? 8787);

const messenger = new Messenger(loadMessagingConfig(), () => broadcast());
const stage = new Stage(messenger, STAGE, () => broadcast());

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '10kb' }));

const originOf = (req: Request) => PUBLIC_URL ?? `${req.protocol}://${req.get('host')}`;

// ───────────── Server-Sent Events (live text demo) ─────────────
const stageClients = new Set<Response>();

function sse(res: Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
}

let broadcastQueued = false;
function broadcast() {
  if (broadcastQueued || !stageClients.size) return;
  broadcastQueued = true;
  setImmediate(() => {
    broadcastQueued = false;
    const sp = `data: ${JSON.stringify(stage.state())}\n\n`;
    for (const res of stageClients) res.write(sp);
  });
}

// Keep proxies from closing idle streams; refresh the stage clock once a minute.
setInterval(() => {
  for (const res of stageClients) res.write(': ping\n\n');
}, 15000).unref();
setInterval(() => broadcast(), 30000).unref();

// ───────────── API helpers ─────────────
const ok = (res: Response, extra: object = {}) => {
  broadcast();
  res.json({ ok: true, ...extra });
};
const bad = (res: Response, status: number, message: string) => res.status(status).json({ ok: false, message });

/** Stage controls trigger real texts, so they can be locked with STAGE_PIN on a public deployment. */
const stagePin = (req: Request, res: Response, next: NextFunction) =>
  stage.checkPin(req.get('x-stage-pin') ?? undefined) ? next() : bad(res, 401, 'Stage PIN required');

app.get('/api/health', (_req, res) => res.json({ ok: true, messaging: messenger.status.provider }));
app.get('/api/messaging/status', (_req, res) => res.json(messenger.status));
// Guest stays, the hotel's activity log and the shared hotel day: the same handlers Vercel runs as serverless functions.
app.all('/api/guest', (req, res) => void guestHandler(req, res));
app.get('/api/activity', (req, res) => void activityHandler(req, res));
app.all('/api/hotel', (req, res) => void hotelHandler(req, res));

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
// Locally the hotel view runs on PORT and the guest app on PORT+1, so each opens in its own tab.
// On a single public URL both live side by side under one origin (guest app at /guest).
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
  /** Served by this server, so the live text demo is available. */
  server: true;
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
    return { view: 'hotel', server: true, hotel: origin, guest: origin, guestQr: origin };
  }
  const name = named[1];
  const at = (port: number) => `${req.protocol}://${name}:${port}`;
  const local = name === 'localhost' || name === '127.0.0.1';
  const lan = lanHosts()[0];
  return {
    view: req.socket.localPort === GUEST_PORT ? 'guest' : 'hotel',
    server: true,
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
    console.log(`Hotel day and guest stays saved to: ${store().kind === 'postgres' ? 'Postgres (DATABASE_URL)' : 'memory — set DATABASE_URL in .env to use the database'}`);
    console.log(`Messaging: ${m.provider} — ${m.note}`);
    console.log(`Stage guest "${STAGE.name}" · room ${STAGE.room} · phone ${STAGE.phone ? maskPhone(normalizePhone(STAGE.phone)) || 'invalid' : 'not set'}${STAGE.pin ? ' · PIN on' : ''}`);
    console.log('Press Ctrl+C to stop.\n');
    if (process.argv.includes('--open')) openTabs([`http://localhost:${PORT}`, `http://localhost:${GUEST_PORT}`]);
  });
  guest.on('error', (e: NodeJS.ErrnoException) => {
    // Still usable on one port: the guest app lives at /guest.
    console.warn(e.code === 'EADDRINUSE' ? portBusy(GUEST_PORT) : String(e));
    console.log(`Hotel view: http://localhost:${PORT} · guest app on the same port at /guest`);
  });
});

server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    console.error(portBusy(PORT));
    process.exit(1);
  }
  throw e;
});
