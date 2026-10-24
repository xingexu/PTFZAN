# FHN AI — Founders Hotel Network

**Pitch the Future 2026 · Western Founders Network**

FHN AI is one live room-state layer on top of FHN's existing property management system. It starts where the October 16 incident hurt most — **room readiness** — and the same data then pays off the other three challenges in the case:

| Challenge | What FHN AI does | Where to see it |
|---|---|---|
| **Room readiness** (the priority) | Predicts a ready-time **range** for every room, re-sequences housekeeping when the day changes, asks a supervisor to approve guest-impacting changes, and texts guests a realistic ETA and "your room is ready". | Overview, Front desk, Supervisor, guest app |
| **Labour** | At 8:00 the forecast shows three attendants can't finish the day, so the on-call attendant is booked — instead of pulling a supervisor and houseperson off their jobs at 3:45. No wasted knocks on occupied rooms. Tomorrow's staffing forecast recommends a floater instead of overtime; green-choice guests lower it live. | Supervisor, Attendant |
| **Maintenance** | Every report becomes one ticket with an owner and a promised time the guest can see. Messy spreadsheet rows ("rm 411 ac not cold") are normalised so repeat faults trigger planned repairs. | Engineering, guest app → Requests |
| **Energy** | Vacant rooms go to eco and come back to the guest's temperature 20 minutes before the forecast says someone will walk in. Never while a guest is inside. | Engineering, Front desk → *Room climate* |

The prototype replays the **Friday, October 16, 2026 shift record (case Exhibit 4, 08:00–17:00)** minute by minute and runs the same day **today's way in parallel**, so every number on screen is a live comparison. Run today's way, it reproduces the log: the 8:00 absence, 10:30 late checkouts, 12:00 elevator failure, 1:15 wedding change, 2:30 readiness calls, 3:00 arrivals, **40 guests waiting and 12 rooms still being prepared at 3:45**, and the check-in queue clearing by 5:00 with the elevator still out.

### Shift record (Exhibit 4) and how each mode handles it

| Time | Exhibit 4 log | Today's process (replay) | With FHN AI |
|---|---|---|---|
| 08:00 | Absence reported after assignments issued; rooms reassigned manually | Orphaned rooms added to the end of everyone's paper list | Re-plan in seconds; forecast books the on-call attendant for 8:45 |
| 10:30 | Late checkouts; staff reach occupied rooms and change route | Attendants knock on occupied rooms (≈155 min lost) | Late rooms moved behind vacant ones |
| 12:00 | Elevator out; carts and guests share one elevator | Same physics | Floors 5–6 batched; ticket linked to 20 rooms |
| 13:15 | Wedding confirms 15:00; priority changes after cleaning started | Supervisor re-prioritises by phone at 14:00 | Supervisor approves a re-plan; guests get ETAs |
| 14:30 | Calls for readiness updates; estimates informal | Desk agents phone housekeeping every 15 min | No calls — live ETAs on every screen |
| 15:00 | Wedding guests begin arriving | Block not handed to the desk yet | Guests with ready rooms go straight up |
| 15:45 | 40 guests waiting, 12 rooms being prepared; escalated | **Same: 40 waiting, 12 rooms**; supervisor, houseperson and evening attendant pulled in | 0 waiting, every room ready |
| 17:00 | Group rooms released; queue clears; elevator still out | **Same**; leftover non-arrival rooms go to the evening shift | Every room finished; suites ready for evening arrivals |

Not in the log, added for the maintenance demo: an in-house guest's AC fails in suite 411 at 2:05 PM.

> All data is simulated, as the case permits. No live hotel systems are connected.

---

## Quick start

Requires **Node 20+**.

```bash
npm install
npm run demo       # builds, starts, and opens both views in their own tabs
```

That opens two separate sites, run by one server so they share the same live hotel:

| Tab | Address | Who it's for |
|---|---|---|
| **Hotel view** | http://localhost:8787 | Staff: overview, front desk, supervisor, attendant, repairs & energy, the plan |
| **Guest view** | http://localhost:8788 | Guests: the hotel's app — check in, live ready time, mobile key, requests, messages |

Anything done in one shows up in the other instantly: when a guest checks in or reports a problem in the guest view, the hotel view pops up "From the guest app" and counts connected guests on its **Guest view** button; when the hotel approves a plan or a room is finished, the guest's phone shows a banner. Each view links to the other, and the two tabs have different icons.

`npm start` does the same without opening tabs. For development with hot reload: `npm run dev` (API on :8787, web on http://localhost:5173, both views on one origin at `/` and `/join`).

Other scripts: `npm test` (simulation tests), `npm run typecheck`.

The start-up log prints the addresses phones on the same Wi-Fi can use; the QR code on the overview points phones at the guest view automatically. If macOS asks whether **node** may accept incoming connections, allow it. If the ports are busy, run `PORT=8790 npm start` (the guest view takes the next port, or set `GUEST_PORT`). On a single public URL (e.g. Render) both views share one address: hotel view at `/`, guest view at `/join`.

---

## Screens

The hotel view is a dark, cinematic console with five screens and a video-style player bar at the bottom (Today / FHN AI, play, skip, the day's moments on a scrubber, the clock, the 30-sec demo). Each moment of the day appears as a subtitle as the playhead passes it; supervisor decisions float above the player.

| Route | Screen | What it shows |
|---|---|---|
| `/` | **Live** | Today's way vs FHN AI, head to head: a 40-seat lobby per side that lights up as guests wait, go out or reach their rooms; one number per challenge; QR code; live feed |
| `/front-desk` | **Rooms** | Room grid with expected ready time, how sure, "why this time", a temperature layer, arrivals, report a problem |
| `/supervisor` | **Team** · Supervisor | Plan to approve, attendant lists, tomorrow's staffing forecast, decision history |
| `/attendant` | **Team** · Attendant phone | What an attendant sees: current room, what's next, one-tap problem reports |
| `/engineering` | **Building** | Repairs with who has them and when, repeat problems in old repair notes, live room-temperature map |
| `/plan` | **Plan** | The business case: why rooms first (Exhibit 1), how it works, four wins, guardrails, $500K roadmap, measures, value, risks |
| `/join` (guest view) | Guests (QR code target) | Hotel-app welcome: find a wedding-guest reservation |
| `/guest/:code` (guest view) | Guests | The guest app: online check-in, live ready time, mobile key, temperature, housekeeping (skip cleaning), report a problem, request items, messages — with in-phone notification banners |
| `/stage` | Projector | **Live SMS moment**: Mike's phone, behind-the-scenes steps, live delivery status |
| `/stage/remote` | Teammate's phone | One big button that triggers the next step of the live moment |

Example guest codes: `WED602`, `WED509`, `STAY411` (in-house guest whose AC fails at 2:05 PM), `RES306`, `RES512` (suite, arriving this evening), `MIKE` (stage guest). Audience guests who join via `/join` get a live ETA after **Check in now**. `/app` reopens the booking last used on that phone.

---

## The 30-second demo

Press **30-sec demo** (gold button in the player bar). It replays the whole shift with FHN AI hands-free in about **28 seconds**:

- races through the morning (sick call, late checkouts, elevator failure) at 30 sim-min/s,
- holds for 2 seconds at **1:15 PM** while the supervisor approves the wedding re-plan,
- slows to 9 sim-min/s from **2:30 to 4:00 PM** — the left lobby (today) fills to the case's 40 waiting guests while FHN AI's guests go straight to their rooms, and judges' phones get "room ready",
- finishes at 5:00 PM with the front desk complete: every room ready, every arrival in their room.

Any manual control (play, pause, speed, step, reset) hands control back to you. **Run the demo again** appears when it ends.

### Pitch script (≈3 minutes)

1. **QR code first.** Judges scan, enter a first name and tap **Check in now** in the guest app. They immediately see a predicted ready-time range.
2. **30-sec demo.** Narrate the four cards as they diverge: at 3:45, 40 wedding guests waiting today vs 0; attendant time lost knocking 155 → 0 min and 222 staff-minutes pulled off other jobs → 0; the 411 AC fixed in 32 vs 100 min with one report instead of two; 168 kWh saved.
3. Judges' phones buzz with "Room … is ready" and the mobile key unlocks.
4. **Rooms** → click a room → *why this time*; flip to **Temperature**.
5. **The plan** for the money questions: $500K phases, success measures, value case.

Manual alternative: the skip button steps through the day's moments; at 1:15 PM a decision card offers **Approve** (or **See plan** for the full list on **Team**). Tick **Auto-approve** on **Team** for an unattended loop.

---
## Live SMS moment ("Mike")

A real text message lands on a real phone, on cue, while you're on stage.

**On stage**

> "My name is Mike. Last time I stayed at an FHN hotel, I stood in the lobby for 45 minutes and got three different answers about my room. Today I checked in online — from the FHN app."
> *(teammate presses ① — Mike's phone buzzes with a realistic ETA)*
> "Instead of waiting in the lobby, I went to grab lunch. Behind the scenes, FHN AI is predicting when room 504 will be ready. The moment the attendant taps *Done*…"
> *(teammate presses ② — **ding**)*
> "…there it is. That's FHN AI telling me my room is ready."

Say **"FHN AI predicts"**, not "AI tracking system" — "tracking" is exactly what the housekeeping union is worried about.

**Setup**

1. Projector laptop: open **`/stage`**. It shows Mike's phone (mirrors the SMS thread), the three behind-the-scenes steps and live delivery status (Queued → Sent to carrier → Delivered).
2. Teammate's phone: open **`/stage/remote`** — one big button. Or use the laptop: **Space / → / PageDown** = next step, **Shift+R** = reset.
3. Mike's phone receives the SMS. Optionally also open `/guest/MIKE` on it for the live page.
4. **⚙ Setup** on `/stage`: set the name, the phone number and the room, then press **Send test text**.
5. **Rehearsal (no texts)** toggle: run the whole thing without spending credit. Switch back to **Live messages** before you go on.

Double presses within 1.5 s are ignored, so a nervous double-tap never sends two texts.

### Option A — send it from your own phone number (free)

Twilio can't send texts from a personal number: verified personal numbers only work as caller ID for voice calls ([Twilio](https://support.twilio.com/hc/en-us/articles/223135427-What-s-the-Difference-Between-a-Verified-Phone-Number-and-a-Twilio-Phone-Number)), and Twilio's Hosted SMS doesn't accept mobile numbers ([Twilio](https://www.twilio.com/docs/phone-numbers/hosted-numbers)). Porting your number to Twilio would move your phone service off your phone — don't. So your own device does the sending:

**Android phone → httpSMS.** Install the httpSMS app ([httpsms.com](https://httpsms.com)), sign in, copy your API key, then in `.env`:

```bash
HTTPSMS_API_KEY=your-key
HTTPSMS_FROM=your number, e.g. 647 555 0123
STAGE_PHONE=the phone that receives the text
```

The SMS goes out through your SIM, on your plan ([API docs](https://docs.httpsms.com)). Keep the phone online, charged and out of battery saver.

**iPhone + Mac → Messages app.** Run the server on the Mac signed in to Messages with your Apple ID, and set `MAC_MESSAGES=sms` (or `imessage` if the receiving phone is an iPhone).
- iPhone: Settings → Messages (iOS 18: Settings → Apps → Messages) → **Text Message Forwarding** → turn on your Mac (needed for SMS).
- Mac: Messages → Settings → iMessage → **Start new conversations from:** your phone number.
- First send: macOS asks to let Terminal control Messages — click **Allow** (or System Settings → Privacy & Security → Automation).

Things to know:
- **Sender and receiver must be different phones.** If your number is also the phone on stage, it would be texting itself — use a teammate's phone as "Mike's phone".
- The receiving phone shows your number or your contact name. Save your number on it as a contact named **FHN Toronto** so the banner reads like the hotel.
- Audience members who join on `/join` are **never** texted from your personal number (they'd get your number). Override only with `ALLOW_GUEST_TEXTS_FROM_PERSONAL_NUMBER=true`.
- If both Twilio and your own phone are configured, `SMS_PROVIDER=httpsms|mac|twilio|ntfy` picks one.

### Option B — a Twilio number

Twilio's free trial **cannot send custom text** — trial accounts can only send Twilio's canned templates to verified numbers ([trial limits](https://www.twilio.com/docs/usage/trials/try-out-sms)). For "room 504 is ready" you need an upgraded account:

1. Create a Twilio account and **upgrade** it (you choose a starting prepaid balance; a few dollars covers hundreds of texts).
2. Buy a **Canadian local number** with SMS capability. Canadian long codes sending to Canadian mobiles need no registration, though carriers filter aggressively — keep the text plain and link-free, as this project does ([Canada SMS guidelines](https://www.twilio.com/en-us/guidelines/ca/sms)).
3. Copy `.env.example` to `.env` and fill in `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` and `STAGE_PHONE`. On Render, add the same keys as environment variables.
4. Restart, open `/stage`, check the badge says **Real SMS via Twilio**, and press **Send test text**.

Want to test the pipeline for free first? Set `TWILIO_TRIAL_TEMPLATE=sms_appointment_reminders` with a trial account: a real text arrives on a verified number, but with Twilio's template wording.

### Option C — free push notification (ntfy)

Not an SMS, but a real notification with sound on the phone, no account or cost. Install the **ntfy** app, subscribe to a hard-to-guess topic, and set `NTFY_TOPIC` to the same name. Used only for the stage guest, never for audience members.

### Guests who join with their number

When Twilio is configured, `/join` offers an optional mobile number with an explicit consent checkbox. Those guests get a real ETA text and a real "room ready" text from the simulation; each message on their page shows whether the text was delivered. Numbers are kept in server memory only, never sent to any browser (everything shown is masked), and are gone when the server restarts. Caps (`SMS_MAX_PER_HOUR`, `SMS_MAX_PER_GUEST_PER_HOUR`) protect your credit.

### Day-of checklist

- [ ] `STAGE_PIN` set if the app is on a public URL (stops audience members from triggering texts)
- [ ] **Send test text** 30 minutes before; confirm it arrives
- [ ] Mike's phone: volume up, **Do Not Disturb / Focus off**, the sending number saved as a contact named "FHN Toronto"
- [ ] Sending from your own phone: it's online, charged, not in battery saver (Android) — or the Mac is awake and signed in to Messages
- [ ] `/stage` badge green, **Live messages** on, scene reset
- [ ] Backup: the in-page alert on `/guest/MIKE`, and a screen recording of a successful run

Honest limits: SMS usually lands in 2–10 seconds but carriers give no guarantee; venue reception matters. Rehearse the timing of your line against real delivery.

---

## How the AI works

**Inputs** (all data FHN already has or can capture with one tap): PMS checkouts, late checkouts, arrivals and group blocks; attendant room-status taps; historical clean time **by room type and condition**; maintenance tickets and the free-text maintenance spreadsheet; staff on shift; smart thermostats where installed.

**1. Readiness forecast** (`server/src/model.ts → predictEtas`)
Simulates each attendant's queue forward using learned room-type averages, checkout availability, travel and elevator penalties, and break timing. Outputs a ready-time **range** whose width grows with queue depth and disruption, plus a confidence level and plain-language drivers.

**2. Constraint-aware sequencing** (`planQueues`)
List scheduling: whoever frees up first takes the room with the best score — earliest need-by time (3:00 PM promise; group blocks first once confirmed), least waiting on a checkout, fewest floor changes (weighted higher when an elevator is down), with stickiness so plans don't churn.

**3. Human in the loop** — routine re-plans auto-apply; changes that affect guest promises pause for supervisor approval.

**4. Guest messaging** — the forecast becomes plain-language updates (ETA, update if it moves ≥15 min, ready, room change, ticket owner and fix), sent only with consent.

**5. Staffing forecast** (`forecastStaffing`) — tomorrow's departures × full-clean time + stayovers × light service (minus green-choice guests), converted to attendants per block against the posted schedule.

**6. Recurring faults** (`normaliseRow`, `findRecurringFaults`) — free-text spreadsheet rows become asset · location · fault; three in 60 days flags a planned repair. The prototype uses keyword rules; the pilot uses an LLM with a fixed output schema.

**7. Room climate** (`engine.ts → updateClimate`) — vacant rooms go to eco; they return to comfort 20 minutes before the readiness forecast (or the guest's "heading back" tap) says someone will walk in.

The forecaster **never sees ground-truth clean times** (hidden per-room condition factors), so "ETA promises kept" is a genuine test.

Pilot path: start rules-based exactly like this, then train a gradient-boosted model on 60–90 days of room-level history.

---

## Guardrails

- **Rooms, not people** — no per-person speed data, tracking or leaderboards (union concern). The staffing forecast is built from reservations, never from individuals.
- **PIPEDA by design** — texts only with consent; each guest's app streams only that guest's booking; no guest personal data in the model.
- **Ranges, not promises** — guests are promised the late end of the window.
- **Approval for guest-impacting changes.**
- **Comfort first** — an occupied room is never set back; guests can override from the app.

---

## Results from the simulation (deterministic)

| Measure | Today's process | With FHN AI |
|---|---|---|
| Wedding guests waiting at 3:45 PM | **40** (Exhibit 4: 40) | 0 |
| Wedding rooms still being prepared at 3:45 PM | **12** (Exhibit 4: 12) | 0 |
| Wedding rooms ready by 3:00 PM | 8 / 20 | 20 / 20 |
| Average lobby wait (arrived guests, full day) | 44 min | 1 min |
| Readiness phone calls | 9 | 0 |
| Attendant time lost knocking on occupied rooms | 155 min | 0 |
| Staff pulled off other jobs at escalation | 222 min (supervisor, houseperson, evening attendant) | 0 — on-call booked at 8:00 |
| Suite 411 AC: reports needed / time to fix | 2 / 100 min | 1 / 32 min |
| kWh saved in vacant rooms (full day, 48 rooms) | 0 | 168 |
| ETA promises kept | n/a | 100% |
| Rooms unfinished at 5:00 PM | 9 (to the evening shift) | 0 |
| Tomorrow's schedule | 2.9 h overtime | one floater 11 AM–3 PM |

How today's process reproduces the log (modelling choices, all from the case text): the absence is covered by appending rooms to paper lists; the supervisor inspects finished rooms in two-hourly rounds because there is "limited visibility into cleaning progress"; the wedding block isn't handed to the desk until the duty manager takes over at 3:45; after escalation rooms are "released after cleaning and inspection". FHN AI's edge comes from two things working together: the 8:00 staffing forecast (an extra attendant all day instead of three people in a panic at 3:45) and coordination (no wasted knocks, instant inspections, live ETAs). Energy figures use planning assumptions (0.9 kWh/h full HVAC vs 0.25 kWh/h eco per room).

---

## Architecture

```
client/  React + Vite + TypeScript
  pages/          Overview, FrontDesk, Supervisor, Housekeeping (attendant), Engineering, Plan,
                  Stage, StageRemote
  pages/guest/    GuestApp, Onboarding, GuestFrame (phone frame on desktop)
  components/     Icon (inline SVG set), Logo, rooms (labels/colours), JoinQr
  links.ts        which view this tab is (hotel or guest) and where the other view lives
  api.ts          fetch helper + SSE hook with reconnect/backoff
server/  Express + TypeScript (run with tsx)
  src/seed.ts       Oct 16 scenario data, maintenance history, tomorrow's reservations
  src/model.ts      forecast + planner + plan diff + staffing forecast + recurring faults
  src/engine.ts     minute-by-minute simulation (readiness, labour, maintenance, climate, guest actions)
  src/demo.ts       30-second autopilot speed profile
  src/messaging.ts  Twilio SMS / ntfy push / simulated, with delivery tracking
  src/stage.ts      the on-cue "Mike" scene
  test/             Vitest: simulation, four challenges, demo timing, messaging, stage
shared/types.ts     domain types used by both sides
```

The server listens on two ports (hotel view and guest view) and tells each page which view it is. It also runs two simulations in lockstep: the one on screen and a shadow run of the same day in the other mode, attached to every update as `compare`. Real-time updates use Server-Sent Events: `/api/stream` (staff, full state), `/api/stage/stream` (stage scene) and `/api/guest/:code/stream` (one guest only). State is in memory; a pilot would persist to PostgreSQL and integrate with the PMS through a read-only adapter.

### Environment variables

See `.env.example`. Everything is optional; with nothing set, messages are simulated on screen.

| Variable | Purpose |
|---|---|
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` (or `TWILIO_MESSAGING_SERVICE_SID`) | Real SMS |
| `TWILIO_TRIAL_TEMPLATE` | Trial accounts: send a Twilio template instead of custom text |
| `HTTPSMS_API_KEY`, `HTTPSMS_FROM` | Send from your own Android phone's number |
| `MAC_MESSAGES` (`sms` / `imessage`) | Send from your Apple ID / iPhone number via the Mac's Messages app |
| `SMS_PROVIDER`, `ALLOW_GUEST_TEXTS_FROM_PERSONAL_NUMBER` | Choose a provider; allow audience texts from a personal number |
| `NTFY_TOPIC`, `NTFY_SERVER` | Free push-notification fallback for the stage guest |
| `STAGE_NAME`, `STAGE_ROOM`, `STAGE_PHONE`, `STAGE_PIN` | Stage guest and control lock |
| `SMS_MAX_PER_HOUR`, `SMS_MAX_PER_GUEST_PER_HOUR` | Spending caps |
| `PORT`, `GUEST_PORT` | Hotel view port (default 8787) and guest view port (default PORT+1) |
| `HOTEL_TIME_ZONE`, `PUBLIC_URL` | Misc |

### API

| Method | Path | Body |
|---|---|---|
| GET | `/api/state`, `/api/stream` | — (includes `compare` from the shadow run) |
| POST | `/api/sim/reset` | `{ mode: "baseline" \| "ai" }` |
| POST | `/api/sim/demo` | — (30-second autopilot) |
| POST | `/api/sim/play` | `{ playing: boolean }` |
| POST | `/api/sim/speed` | `{ speed: 5\|10\|20\|30\|60 }` (sim minutes per second) |
| POST | `/api/sim/step` | `{ minutes }` |
| POST | `/api/sim/next-event` | — |
| POST | `/api/sim/auto-approve` | `{ value: boolean }` |
| POST | `/api/proposals/:id/approve` · `/dismiss` | — |
| POST | `/api/rooms/:id/issue` | `{ issue }` |
| POST | `/api/guests/demo` | `{ name, phone?, consent?, checkIn? }` (`checkIn: false` = finish in the app) |
| GET | `/api/guest/:code`, `/api/guest/:code/stream` | — |
| POST | `/api/guest/:code/check-in` | — |
| POST | `/api/guest/:code/issue` | `{ issue }` |
| POST | `/api/guest/:code/request` | `{ item }` |
| POST | `/api/guest/:code/climate` | `{ setpoint?, awayMinutes?: number \| null }` |
| POST | `/api/guest/:code/housekeeping` | `{ pref: "standard" \| "green" \| "dnd" }` |
| GET | `/api/messaging/status` | — |
| GET | `/api/stage/state`, `/api/stage/stream` | — |
| POST | `/api/stage/next` · `check-in` · `ready` · `reset` · `test` | header `x-stage-pin` when `STAGE_PIN` is set |
| POST | `/api/stage/config` | `{ name?, phone?, room? }` |
| POST | `/api/stage/send-real` | `{ value: boolean }` |

---

## Deploying for the live pitch

SSE needs a long-running server, so use a host that runs Node or Docker (Render, Railway, Fly.io) rather than serverless functions.

- **Render**: connect the repo — `render.yaml` is included (service name `fhn-operations`).
- **Docker**: `docker build -t fhn-operations . && docker run -p 8787:8787 fhn-operations`.

Browser system notifications require **HTTPS** (any of the hosts above). Over plain HTTP the guest app still alerts in-app with a chime and vibration.

**Always keep a fallback:** run `npm run build && npm start` on the presenting laptop, and record a screen capture of the 30-second demo in case the venue Wi-Fi fails.
