import express, { type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Mode } from '../../shared/types.js';
import { Simulation } from './engine.js';

const PORT = Number(process.env.PORT ?? 8787);
const sim = new Simulation('readypath');
const app = express();
app.use(express.json({ limit: '10kb' }));

// ───────────── Server-Sent Events: staff stream (full state) + per-guest scoped streams ─────────────
const staffClients = new Set<Response>();
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

let broadcastQueued = false;
function broadcast() {
  if (broadcastQueued) return;
  broadcastQueued = true;
  setImmediate(() => {
    broadcastQueued = false;
    const payload = `data: ${JSON.stringify(sim.state)}\n\n`;
    for (const res of staffClients) res.write(payload);
    for (const [res, code] of guestClients) {
      const v = sim.guestView(code);
      res.write(`data: ${JSON.stringify(v)}\n\n`);
    }
  });
}

// Keep proxies from closing idle streams.
setInterval(() => {
  for (const res of [...staffClients, ...guestClients.keys()]) res.write(': ping\n\n');
}, 15000).unref();

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

// ───────────── API ─────────────
const ok = (res: Response, extra: object = {}) => {
  broadcast();
  res.json({ ok: true, ...extra });
};
const bad = (res: Response, status: number, message: string) => res.status(status).json({ ok: false, message });

app.get('/api/health', (_req, res) => res.json({ ok: true, now: sim.state.now, mode: sim.state.mode }));
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

app.post('/api/guests/demo', (req, res) => {
  const name = String(req.body?.name ?? '').replace(/[<>]/g, '').trim();
  if (!name) return bad(res, 400, 'Please enter a first name');
  const g = sim.addDemoGuest(name);
  ok(res, { code: g.code });
});

app.get('/api/guest/:code', (req, res) => {
  const v = sim.guestView(req.params.code);
  return v ? res.json(v) : bad(res, 404, 'We could not find that booking code');
});

app.get('/api/guest/:code/stream', (req, res) => {
  const v = sim.guestView(req.params.code);
  if (!v) return bad(res, 404, 'We could not find that booking code');
  sse(res);
  guestClients.set(res, req.params.code);
  res.write(`data: ${JSON.stringify(v)}\n\n`);
  req.on('close', () => guestClients.delete(res));
});

app.post('/api/guest/:code/prefs', (req, res) =>
  sim.setGuestPrefs(req.params.code, !!req.body?.notifyBrowser) ? ok(res) : bad(res, 404, 'Unknown code'));

app.use('/api', (_req, res) => bad(res, 404, 'Not found'));

// ───────────── Static client (production) ─────────────
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../../dist');
if (existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`ReadyPath API listening on http://localhost:${PORT}`);
});
