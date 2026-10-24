# ReadyPath — Founders Hotel Network

**Pitch the Future 2026 · Western Founders Network**

ReadyPath is an AI room-readiness layer that sits on top of FHN's existing property management system. It predicts **when each room will be ready (as a range)**, **re-sequences housekeeping** when the day changes, asks a **supervisor to approve** anything that affects guest promises, and **notifies guests** with a realistic ETA and a "your room is ready" message.

This repo is a working, full-stack prototype that replays the **Friday, October 16, 2026** incident from the case minute by minute — once with today's process and once with ReadyPath. Same sick call, same late checkouts, same elevator failure, same wedding.

> All data is simulated, as the case permits. No live hotel systems are connected.

---

## Quick start

Requires **Node 20+**.

```bash
npm install
npm run dev        # API on :8787 + web on :5173 (hot reload)
```

Open http://localhost:5173.

Production build (single server, one port):

```bash
npm run build
npm start          # serves the app and API on http://localhost:8787
```

Other scripts: `npm test` (simulation tests), `npm run typecheck`.

---

## Screens

| Route | Who | What it shows |
|---|---|---|
| `/` | Duty manager / judges | Live KPIs, wedding-party lobby view, shift log, QR code to join as a guest |
| `/front-desk` | Front-desk agents | Room grid with predicted ready time, confidence, at-risk flags, "why this estimate", arrivals list, report-an-issue |
| `/supervisor` | Housekeeping supervisor | Proposed re-plan with reasons + predicted impact, **Approve / Keep current plan**, attendant queues, maintenance tickets |
| `/housekeeping` | Room attendant | Phone view: current room, next rooms (always actually vacant), one-tap issue reporting |
| `/guest/:code` | Guests | Mobile page with live ETA, progress, messages, browser notifications, mobile key |
| `/join` | Judges / audience | Create a demo wedding guest and get notified on your own phone |
| `/how-it-works` | Everyone | Data → AI → outputs, guardrails, pilot budget, success measures |

Example guest codes: `WED602`, `WED505`, `RES306`.

---

## 3-minute live demo script

1. **Overview, mode "Today"** → press **Next event** until 3:45 PM. Lobby fills up, readiness calls climb, guests have no ETA.
2. Switch to **With ReadyPath** (resets to 8:00 AM). Put the QR code on screen and let judges **join as wedding guests** on their phones.
3. **Next event** ×4 → at **1:15 PM** the sim pauses: *"Wedding arrives 3:00 PM"*. Open **Supervisor**, read one reason, click **Approve & notify guests**. Judges' phones show their ETA.
4. **Front desk** → click a red-bordered room → show *why this estimate*. Optional: **Report → AC not cooling** to show the guest re-roomed and told who owns the fix.
5. Press **Play** (10–20 min/s). Judges' phones buzz *"Room 504 is ready"*. Overview at 3:45 PM: lobby nearly empty, guests informed and away, ETA promises kept.

Tip: tick **Auto-approve** on the Supervisor screen for an unattended loop.

---

## How the AI works

**Inputs** (all data FHN already has or can capture with one tap): PMS checkouts, late checkouts, arrivals and group blocks; attendant room-status taps; historical clean time **by room type and condition**; maintenance tickets and asset status; staff on shift.

**1. Readiness forecast** (`server/src/model.ts → predictEtas`)
Simulates each attendant's queue forward using learned room-type averages, checkout availability, travel and elevator penalties, and break timing. Outputs a ready-time **range** whose width grows with queue depth and disruption, plus a confidence level and plain-language drivers.

**2. Constraint-aware sequencing** (`planQueues`)
List scheduling: whoever frees up first takes the room with the best score — earliest need-by time (3:00 PM promise; group blocks first once confirmed), least waiting on a checkout, fewest floor changes (weighted higher when an elevator is down), with stickiness so plans don't churn.

**3. Human in the loop** — routine re-plans auto-apply; changes that affect guest promises pause for supervisor approval.

**4. Guest messaging** — the forecast becomes plain-language updates (ETA, update if it moves ≥15 min, ready, room change), sent only with consent.

The forecaster **never sees ground-truth clean times** (hidden per-room condition factors), so "ETA promises kept" is a genuine test.

Pilot path: start rules-based exactly like this, then train a gradient-boosted model on 60–90 days of room-level history.

---

## Guardrails

- **Rooms, not people** — no per-person speed data, tracking or leaderboards (union concern).
- **PIPEDA by design** — texts only with consent; guest portal streams only that guest's booking; no guest personal data in the model.
- **Ranges, not promises** — guests are promised the late end of the window.
- **Approval for guest-impacting changes.**

---

## Results from the simulation (deterministic)

At the 3:45 PM checkpoint:

| Measure | Today | With ReadyPath |
|---|---|---|
| Guests waiting in lobby | 18 | 0 |
| Wedding rooms ready by 3:00 PM | 9 / 20 | 13 / 20 |
| Average lobby wait | 14 min | 2 min |
| Readiness phone calls | 7 | 0 |
| Wasted visits to occupied rooms | 30 | 0 |
| Guests with a realistic ETA | 0 | all who consented |
| ETA promises kept | n/a | ~86% |

Honest notes: the case reports 40 guests waiting; our conservative model produces ~20. The biggest gain is **information**, not cleaning speed — ReadyPath gets ~4 more wedding rooms ready in time, but it gets **every** guest a reliable answer.

---

## Architecture

```
client/ (React + Vite + TypeScript)           server/ (Express + TypeScript via tsx)
  pages/ Overview, FrontDesk, Supervisor,       src/seed.ts    Oct 16 scenario data
         Housekeeping, GuestPortal, Join,       src/model.ts   forecast + planner + plan diff
         HowItWorks                             src/engine.ts  minute-by-minute simulation
  api.ts  SSE hook with reconnect/backoff       src/index.ts   REST + Server-Sent Events
shared/types.ts  domain types used by both      test/          Vitest scenario tests
```

Real-time updates use Server-Sent Events: `/api/stream` (staff, full state) and `/api/guest/:code/stream` (one guest only). State is in memory; a pilot would persist to PostgreSQL and integrate with the PMS through a read-only adapter.

### API

| Method | Path | Body |
|---|---|---|
| GET | `/api/state`, `/api/stream` | — |
| POST | `/api/sim/reset` | `{ mode: "baseline" \| "readypath" }` |
| POST | `/api/sim/play` | `{ playing: boolean }` |
| POST | `/api/sim/speed` | `{ speed: 1\|2\|5\|10\|20\|40 }` (sim minutes per second) |
| POST | `/api/sim/step` | `{ minutes }` |
| POST | `/api/sim/next-event` | — |
| POST | `/api/sim/auto-approve` | `{ value: boolean }` |
| POST | `/api/proposals/:id/approve` · `/dismiss` | — |
| POST | `/api/rooms/:id/issue` | `{ issue }` |
| POST | `/api/guests/demo` | `{ name }` |
| GET | `/api/guest/:code`, `/api/guest/:code/stream` | — |

---

## Deploying for the live pitch

SSE needs a long-running server, so use a host that runs Node or Docker (Render, Railway, Fly.io) rather than serverless functions.

- **Render**: connect the repo — `render.yaml` is included.
- **Docker**: `docker build -t readypath . && docker run -p 8787:8787 readypath`.

Browser system notifications require **HTTPS** (any of the hosts above). Over plain HTTP the guest page still alerts in-page with a chime and vibration.

**Always keep a fallback:** run `npm run build && npm start` on the presenting laptop, and record a 2-minute screen capture in case the venue Wi-Fi fails.
