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
| `/stage` | Projector during the pitch | **Live SMS moment**: Mike's phone, behind-the-scenes steps, live delivery status |
| `/stage/remote` | Teammate's phone | One big button that triggers the next step of the live moment |

Example guest codes: `WED602`, `WED505`, `RES306`, `MIKE` (stage guest).

---

## 3-minute live demo script

1. **Overview, mode "Today"** → press **Next event** until 3:45 PM. Lobby fills up, readiness calls climb, guests have no ETA.
2. Switch to **With ReadyPath** (resets to 8:00 AM). Put the QR code on screen and let judges **join as wedding guests** on their phones.
3. **Next event** ×4 → at **1:15 PM** the sim pauses: *"Wedding arrives 3:00 PM"*. Open **Supervisor**, read one reason, click **Approve & notify guests**. Judges' phones show their ETA.
4. **Front desk** → click a red-bordered room → show *why this estimate*. Optional: **Report → AC not cooling** to show the guest re-roomed and told who owns the fix.
5. Press **Play** (10–20 min/s). Judges' phones buzz *"Room 504 is ready"*. Overview at 3:45 PM: lobby nearly empty, guests informed and away, ETA promises kept.

Tip: tick **Auto-approve** on the Supervisor screen for an unattended loop.

---

## Live SMS moment ("Mike")

A real text message lands on a real phone, on cue, while you're on stage.

**On stage**

> "My name is Mike. Last time I stayed at an FHN hotel, I stood in the lobby for 45 minutes and got three different answers about my room. Today I checked in online — from the FHN app I already have."
> *(teammate presses ① — Mike's phone buzzes with a realistic ETA)*
> "Instead of waiting in the lobby, I went to grab lunch. Behind the scenes, ReadyPath is predicting when room 504 will be ready. The moment the attendant taps *Done*…"
> *(teammate presses ② — **ding**)*
> "…there it is. That's the live system telling me my room is ready."

Say **"ReadyPath predicts"**, not "AI tracking system" — "tracking" is exactly what the housekeeping union is worried about.

**Setup**

1. Projector laptop: open **`/stage`**. It shows Mike's phone (mirrors the SMS thread), the three behind-the-scenes steps and live delivery status (Queued → Sent to carrier → Delivered).
2. Teammate's phone: open **`/stage/remote`** — one big button. Or use the laptop: **Space / → / PageDown** = next step, **Shift+R** = reset.
3. Mike's phone receives the SMS. Optionally also open `/guest/MIKE` on it for the live page.
4. **⚙ Setup** on `/stage`: set the name, the phone number and the room, then press **Send test text**.
5. **Rehearsal (no texts)** toggle: run the whole thing without spending credit. Switch back to **Live messages** before you go on.

Double presses within 1.5 s are ignored, so a nervous double-tap never sends two texts.

### Making it a real SMS (Twilio)

Twilio's free trial **cannot send custom text** — trial accounts can only send Twilio's canned templates to verified numbers ([trial limits](https://www.twilio.com/docs/usage/trials/try-out-sms)). For "room 504 is ready" you need an upgraded account:

1. Create a Twilio account and **upgrade** it (you choose a starting prepaid balance; a few dollars covers hundreds of texts).
2. Buy a **Canadian local number** with SMS capability. Canadian long codes sending to Canadian mobiles need no registration, though carriers filter aggressively — keep the text plain and link-free, as this project does ([Canada SMS guidelines](https://www.twilio.com/en-us/guidelines/ca/sms)).
3. Copy `.env.example` to `.env` and fill in `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` and `STAGE_PHONE`. On Render, add the same keys as environment variables.
4. Restart, open `/stage`, check the badge says **Real SMS via Twilio**, and press **Send test text**.

Want to test the pipeline for free first? Set `TWILIO_TRIAL_TEMPLATE=sms_appointment_reminders` with a trial account: a real text arrives on a verified number, but with Twilio's template wording.

### Free fallback: push notification (ntfy)

Not an SMS, but a real notification with sound on the phone, no account or cost. Install the **ntfy** app, subscribe to a hard-to-guess topic, and set `NTFY_TOPIC` to the same name. Used only for the stage guest, never for audience members.

### Guests who join with their number

When Twilio is configured, `/join` offers an optional mobile number with an explicit consent checkbox. Those guests get a real ETA text and a real "room ready" text from the simulation; each message on their page shows whether the text was delivered. Numbers are kept in server memory only, never sent to any browser (everything shown is masked), and are gone when the server restarts. Caps (`SMS_MAX_PER_HOUR`, `SMS_MAX_PER_GUEST_PER_HOUR`) protect your credit.

### Day-of checklist

- [ ] `STAGE_PIN` set if the app is on a public URL (stops audience members from triggering texts)
- [ ] **Send test text** 30 minutes before; confirm it arrives
- [ ] Mike's phone: volume up, **Do Not Disturb / Focus off**, the FHN number saved as a contact named "FHN Toronto"
- [ ] `/stage` badge green, **Live messages** on, scene reset
- [ ] Backup: the in-page alert on `/guest/MIKE`, and a screen recording of a successful run

Honest limits: SMS usually lands in 2–10 seconds but carriers give no guarantee; venue reception matters. Rehearse the timing of your line against real delivery.

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
client/  React + Vite + TypeScript
  pages/        Overview, FrontDesk, Supervisor, Housekeeping, HowItWorks,
                GuestPortal, Join, Stage, StageRemote
  api.ts        fetch helper + SSE hook with reconnect/backoff
server/  Express + TypeScript (run with tsx)
  src/seed.ts       Oct 16 scenario data
  src/model.ts      forecast + planner + plan diff
  src/engine.ts     minute-by-minute simulation
  src/messaging.ts  Twilio SMS / ntfy push / simulated, with delivery tracking
  src/stage.ts      the on-cue "Mike" scene
  src/index.ts      REST + Server-Sent Events
  test/             Vitest: simulation, messaging (mock Twilio server), stage
shared/types.ts     domain types used by both sides
```

Real-time updates use Server-Sent Events: `/api/stream` (staff, full state), `/api/stage/stream` (stage scene) and `/api/guest/:code/stream` (one guest only). State is in memory; a pilot would persist to PostgreSQL and integrate with the PMS through a read-only adapter.

### Environment variables

See `.env.example`. Everything is optional; with nothing set, messages are simulated on screen.

| Variable | Purpose |
|---|---|
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` (or `TWILIO_MESSAGING_SERVICE_SID`) | Real SMS |
| `TWILIO_TRIAL_TEMPLATE` | Trial accounts: send a Twilio template instead of custom text |
| `NTFY_TOPIC`, `NTFY_SERVER` | Free push-notification fallback for the stage guest |
| `STAGE_NAME`, `STAGE_ROOM`, `STAGE_PHONE`, `STAGE_PIN` | Stage guest and control lock |
| `SMS_MAX_PER_HOUR`, `SMS_MAX_PER_GUEST_PER_HOUR` | Spending caps |
| `HOTEL_TIME_ZONE`, `PUBLIC_URL`, `PORT` | Misc |

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
| GET | `/api/messaging/status` | — |
| GET | `/api/stage/state`, `/api/stage/stream` | — |
| POST | `/api/stage/next` · `check-in` · `ready` · `reset` · `test` | header `x-stage-pin` when `STAGE_PIN` is set |
| POST | `/api/stage/config` | `{ name?, phone?, room? }` |
| POST | `/api/stage/send-real` | `{ value: boolean }` |

---

## Deploying for the live pitch

SSE needs a long-running server, so use a host that runs Node or Docker (Render, Railway, Fly.io) rather than serverless functions.

- **Render**: connect the repo — `render.yaml` is included.
- **Docker**: `docker build -t readypath . && docker run -p 8787:8787 readypath`.

Browser system notifications require **HTTPS** (any of the hosts above). Over plain HTTP the guest page still alerts in-page with a chime and vibration.

**Always keep a fallback:** run `npm run build && npm start` on the presenting laptop, and record a 2-minute screen capture in case the venue Wi-Fi fails.
