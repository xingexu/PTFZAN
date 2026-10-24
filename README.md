# FHN AI — Founders Hotel Network

**Pitch the Future 2026 · Western Founders Network**

FHN AI is one live room-state layer on top of FHN's existing property management system. It starts where the October 16 incident hurt most — **room readiness** — and the same data then pays off the other three challenges in the case:

| Challenge | What FHN AI does | Where to see it |
|---|---|---|
| **Room readiness** (the priority) | Predicts a ready-time **range** for every room, re-sequences housekeeping when the day changes, asks a supervisor to approve guest-impacting changes, and texts guests a realistic ETA and "your room is ready". | Live, Rooms, Team, guest app |
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
cp .env.example .env   # then set DATABASE_URL (optional locally — without it, the shared day and guest stays are kept in memory)
npm run demo           # builds, starts, and opens both views in their own tabs
```

That opens two separate sites:

| Tab | Address | Who it's for |
|---|---|---|
| **Hotel view** | http://localhost:8787 | The hotel team and the judges: the live day, rooms, team, building |
| **Guest view** | http://localhost:8788 | Guests: the hotel's app — register, check in, ready time, mobile key, requests, messages |

The mint **Guest app** button in the hotel view's top bar opens the guest app; the QR code on the Live screen does the same for phones. The two tabs have different icons and each links to the other.

`npm start` does the same without opening tabs. For development with hot reload: `npm run dev` (web on http://localhost:5173, guest app at `/guest`, API proxied to :8787).

Other scripts: `npm test` (simulation, guest stay and API tests — they never touch the real database), `npm run typecheck`.

The start-up log prints the addresses phones on the same Wi-Fi can use, and where guest stays are being saved. If macOS asks whether **node** may accept incoming connections, allow it. If the ports are busy, run `PORT=8790 npm start` (the guest view takes the next port, or set `GUEST_PORT`).

### How it fits together

- **One hotel day, shared by every screen, kept in PostgreSQL.** The database holds the day's clock (method, play/pause, speed, the 30-second demo) and a log of every decision (plan approvals, problem reports). The simulation is deterministic, so each open hotel screen rebuilds exactly the same October 16 from those two things and follows it as time passes — the laptop, the projector and a phone all show the same rooms at the same minute, and any of them can drive. Changes made on one screen appear on the others within about a second, with a short note. The top bar shows **Synced · N screens**; if the database can't be reached, the day keeps running on that screen only and rejoins on its own. While anyone is watching, the server also writes the live hotel to `fhn.rooms` and `fhn.hotel_snapshot`, so the current state of every room can be read straight from the database.
- **Guest stays are saved in PostgreSQL** (a Supabase project in Canada, `ca-central-1`). Registering, checking in and everything a guest does in the app goes through two small API functions (`api/guest.ts`, `api/activity.ts`) — Vercel serverless functions in production, mounted by the local server on a laptop.
- **FHN AI chooses the room at check-in — on the server.** When a guest taps *Check in now*, the phone sends the request to the server, which decides in one locked step (Postgres `pg_advisory_xact_lock`, so two guests checking in at the same moment never get the same room or the same place in an attendant's list). It reads every guest still holding a room, pairs each free room with each of the four attendants on duty (Attendant 4 on floor 6, the backup covering floor 5 for the sick Attendant 3, Attendants 1–2 coming up from floors 3–4 by the service elevator), and picks the pair with the earliest forecast ready time — the wedding block first, two beds or a suite for a party of three or four. The forecast uses the hotel model's numbers: the attendant's list ahead, the walk there, the room type's average clean (King 35, Double Queen 39, Suite 52 min) and the 6-minute final check. The guest is promised the late end of a window that widens with the room's place in that list, and the reasons are saved with the decision (*How FHN AI worked this out*). Messages then arrive when each moment comes: checked in with the ready time, cleaning started, final check, room ready (with the key active). The guest app runs at demo speed — one hotel minute every 2 seconds — so a wait is about 1½–3 minutes, shown as a countdown ring on the phone and, to the second, on the hotel's Rooms tab.
- **Both views stay linked.** The hotel view reads the guests' activity every few seconds: new registrations, check-ins, phone-key unlocks and problem reports pop up on the hotel screen and in its **Hotel log**, and the Guest app button shows how many people have registered.
- **Privacy.** The hotel screen shows first names only. A guest's phone keeps just a secret id for their stay; **End this stay** in the app deletes their details from the database.

---

## Screens

Both apps are light: a white page with soft light-blue light behind it, dark text and one blue accent (FHN AI, primary buttons, links), in the manner of Apple and Google; status colours (green ready, indigo cleaning, yellow final check, orange needs cleaning) appear only on rooms, and the previous method is shown in grey. Every panel and button is liquid glass: translucent white that blurs what is behind it, a bright rim that catches the light where the pointer or finger is, a slow shimmer and a soft blue glow; everything fades in as it appears. The top bar and the player float above the page. On a laptop or projector every screen fits exactly — long lists scroll inside their own panel — and switching screens, modes or layers cross-fades. The day's moments are written into the Hotel log; a supervisor decision appears just above the player. On a phone the screens stack and scroll normally.

| Route | Screen | What it shows |
|---|---|---|
| `/` | **Live** | Labelled as a simulation. The previous method vs the new AI, side by side, each drawn as a 2D cross-section of the hotel: four guest floors over the lobby, every room a window that changes colour as it's prepared and turns green when ready; wedding rooms ready out of 20 with a progress bar; and the 40 wedding guests in the lobby, shown in colour while they wait. Below, the four challenges as simple two-bar comparisons. On the right, the guest app QR code and the **Hotel log**: the day's big moments in plain words, plus what real guests are doing in the app |
| `/front-desk` | **Rooms** | Room grid with expected ready time, how sure, "why this time", a temperature layer, arrivals, report a problem |
| `/supervisor` | **Team** · Supervisor | Plan to approve, attendant lists, tomorrow's staffing forecast, decision history |
| `/attendant` | **Team** · Attendant phone | Every attendant at a glance; tap one to see their phone (current room, what's next, one-tap problem reports); and what changes for attendants, today's way vs FHN AI |
| `/engineering` | **Building** | Repairs with who has them and when, repeat problems in old repair notes, live room-temperature map |
| `/` (guest view) | Guests (QR code target) | Welcome: register with name, optional email and party size |
| `/stay` (guest view) | Guests | The guest app: online check-in, FHN AI's calculated ready time with a countdown, mobile key, temperature, housekeeping (skip cleaning), report a problem, request items, messages — with in-phone notification banners, and a link to the hotel's FHN AI view. Phones and tablets get the app full screen, laid out like an iOS app (large titles, grouped lists, safe areas for the notch and home indicator); a laptop shows it in a phone frame |
| `/stage` | Projector (local server only) | **Live SMS moment**: Mike's phone, behind-the-scenes steps, live delivery status |
| `/stage/remote` | Teammate's phone (local server only) | One big button that triggers the next step of the live moment |

---

## The 30-second demo

Press **30-sec demo** (gold button in the player bar). It replays the whole shift with FHN AI hands-free in about **28 seconds**:

- races through the morning (sick call, late checkouts, elevator failure) at 30 sim-min/s,
- holds for 2 seconds at **1:15 PM** while the supervisor approves the wedding re-plan,
- slows to 9 sim-min/s from **2:30 to 4:00 PM** — FHN AI's wedding rooms are all green by 3 PM while today's way is stuck at 8 of 20 and its lobby fills to the case's 40 waiting guests,
- finishes at 5:00 PM with the front desk complete: every room ready, every arrival in their room.

Any manual control (play, pause, speed, step, reset) hands control back to you. **Play again** appears when it ends.

### Pitch script (≈3 minutes)

1. **QR code first.** Judges scan, register, and tap **Check in now** in the guest app. They immediately see when their room will be ready and a countdown.
2. **30-sec demo.** Narrate the four cards as they diverge: at 3:45, 40 wedding guests waiting today vs 0; attendant time lost knocking 155 → 0 min and 222 staff-minutes pulled off other jobs → 0; the 411 AC fixed in 32 vs 100 min with one report instead of two; 168 kWh saved.
3. About two minutes after check-in, judges' phones show "Room … is ready" and the mobile key unlocks.
4. **Rooms** → click a room → *why this time*; flip to **Temperature**.

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

### Day-of checklist

- [ ] `STAGE_PIN` set if the app is on a public URL (stops audience members from triggering texts)
- [ ] **Send test text** 30 minutes before; confirm it arrives
- [ ] Mike's phone: volume up, **Do Not Disturb / Focus off**, the sending number saved as a contact named "FHN Toronto"
- [ ] Sending from your own phone: it's online, charged, not in battery saver (Android) — or the Mac is awake and signed in to Messages
- [ ] `/stage` badge green, **Live messages** on, scene reset
- [ ] Backup: the phone on `/stage` shows the message too, and a screen recording of a successful run

Honest limits: SMS usually lands in 2–10 seconds but carriers give no guarantee; venue reception matters. Rehearse the timing of your line against real delivery.

---

## How the AI works

**Inputs** (all data FHN already has or can capture with one tap): PMS checkouts, late checkouts, arrivals and group blocks; attendant room-status taps; historical clean time **by room type and condition**; maintenance tickets and the free-text maintenance spreadsheet; staff on shift; smart thermostats where installed.

**1. Readiness forecast** (`shared/sim/model.ts → predictEtas`)
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
- **PIPEDA by design** — texts only with consent; guest data is stored in Canada, shown to the hotel by first name only, and deleted when the guest ends their stay; no guest personal data in the model.
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
api/                 serverless functions (Vercel); the local server mounts the same handlers
  hotel.ts           the shared hotel day: its clock and decision log; refreshes the live room tables
  guest.ts           a guest's stay: register, read, every action in the app, end (delete)
  activity.ts        what guests are doing, for the hotel screen
  _lib/store.ts      PostgreSQL (DATABASE_URL) or memory; _lib/http.ts small request helpers
client/  React + Vite + TypeScript
  hotel/host.ts      follows the shared day: polls the clock and decisions, corrects for clock drift, runs it locally if offline
  hotel/activity.ts  reads guest activity for the hotel view every few seconds
  guest/journey.ts   the guest app's link to its stay (optimistic actions, server clock)
  pages/             Overview (Live), FrontDesk, Supervisor, Housekeeping (attendant), Engineering, Stage, StageRemote
  pages/guest/       Welcome (register), GuestApp, GuestFrame (phone frame on desktop)
  components/        Icon (inline SVG set), Logo (the FHN mark), rooms (labels/colours), PageHead
  links.ts           which view this tab is (hotel or guest) and where the other view lives
shared/
  guest/assign.ts    FHN AI's check-in decision: which room, which attendant, the promised window (run on the server)
  guest/stay.ts      one guest's stay: the timeline, timed messages, requests — used by server and phone
  sim/seed.ts        Oct 16 scenario data, maintenance history, tomorrow's reservations
  sim/model.ts       forecast + planner + plan diff + staffing forecast + recurring faults
  sim/engine.ts      minute-by-minute simulation (readiness, labour, maintenance, climate)
  sim/demo.ts        30-second autopilot speed profile
  sim/timeline.ts    the shared day: controls → clock + decision log, and Replay, which rebuilds the hotel from them
  types.ts           domain types used everywhere
server/  Express + TypeScript (run with tsx), local only
  src/index.ts       serves both views on two ports, the API, the live SMS moment
  src/messaging.ts   Twilio SMS / your own phone / ntfy push / simulated, with delivery tracking
  src/stage.ts       the on-cue "Mike" scene
  test/              Vitest: simulation, four challenges, demo timing, shared day, guest stay, APIs, messaging
```

### Database

Everything lives in its own `fhn` schema (not exposed through Supabase's public Data API):

| Table | What's in it |
|---|---|
| `fhn.hotel_control` | The shared day's clock — one row: run, method, playing, speed, 30-second demo, where the clock was set and when, version |
| `fhn.hotel_events` | Every decision made on any screen, in order: plan approved or kept, auto-approve on/off, problem reported (with the minute of the day) |
| `fhn.rooms` | Live status of all 48 rooms in the shared day: status, wedding block, expected ready time and range, temperature mode, attendant |
| `fhn.hotel_snapshot` | The day at a glance: clock, both methods' numbers, the latest hotel log |
| `fhn.hotel_viewers` | Hotel screens open right now (for "Synced · N screens") |
| `fhn.guests` | One row per registration: name, optional email, party size, preferences; at check-in, FHN AI's decision — `room_id`, `attendant`, `ready_at`, `promised_at`, and the full `plan` with its reasons |
| `fhn.requests` | Problems reported and items requested, per guest |
| `fhn.activity` | The lines shown in the hotel's log (first names only) |

Two screens pressing a control at the same moment can't overwrite each other: the clock row carries a version, and the server re-reads and re-applies on a clash.

The app connects as `fhn_app`, a login that can only read and write these tables, through Supabase's connection pooler (port 6543). Browse the data in the Supabase dashboard → project **fhn-ai** → Table Editor → schema `fhn`. The schema is in `supabase/migrations/` (the login's password is set separately and never stored in the repository).

Hotel screens check the shared day every second while it plays (every few seconds when paused, less often in a background tab); the guest app re-reads its stay every 15 seconds and whenever it comes back into view; the hotel view reads guest activity every 4 seconds.

### Environment variables

See `.env.example`. Everything is optional locally; with nothing set, the shared day and guest stays live in memory and messages are simulated on screen.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string for the shared hotel day and guest stays (Supabase transaction pooler, `fhn_app` login) |
| `VITE_VIEW`, `VITE_HOTEL_URL`, `VITE_GUEST_URL` | Vercel builds: which view this site is, and where the other one lives |
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
| GET | `/api/hotel?run=&after=<event id>&viewer=` | — → `{ control, events, serverNow, viewers }` (only decisions this screen hasn't seen) |
| POST | `/api/hotel` | `{ action: "reset" \| "demo" \| "play" \| "speed" \| "next-event" \| "approve" \| "dismiss" \| "auto-approve" \| "issue", minute, … }` → `{ control, events, serverNow }` |
| POST | `/api/guest` | `{ action: "register", name, email?, party }` → `{ stay }` |
| GET | `/api/guest?id=…` | — → `{ stay }` |
| POST | `/api/guest` | `{ action: "check-in", id }` → `{ stay }` — the server chooses the room and attendant (`shared/guest/assign.ts`) |
| POST | `/api/guest` | `{ action: "unlock" \| "issue" \| "request" \| "climate" \| "housekeeping" \| "prefs", id, … }` → `{ stay }` |
| POST | `/api/guest` | `{ action: "end", id }` — deletes the guest's data |
| GET | `/api/activity?after=<id>` | — → `{ items, counts, arrivals }` (first names only; arrivals carry the same timer as each guest's phone) |
| GET | `/api/messaging/status` | — (local server) |
| GET | `/api/stage/state`, `/api/stage/stream` | — (local server) |
| POST | `/api/stage/next` · `check-in` · `ready` · `reset` · `test` | header `x-stage-pin` when `STAGE_PIN` is set (local server) |
| POST | `/api/stage/config` | `{ name?, phone?, room? }` (local server) |
| POST | `/api/stage/send-real` | `{ value: boolean }` (local server) |

---

## Deploying for the live pitch

### Vercel: two sites from this repo

`vercel.json` is included. Create two Vercel projects that both import this repository:

| Project | Environment variables |
|---|---|
| **Hotel view** (e.g. `fhn-hotel`) | `VITE_VIEW=hotel`, `VITE_GUEST_URL=https://<guest project>.vercel.app`, `DATABASE_URL` |
| **Guest view** (e.g. `fhn-guest`) | `VITE_VIEW=guest`, `VITE_HOTEL_URL=https://<hotel project>.vercel.app`, `DATABASE_URL` |

Set the variables for Production (and Preview if you use it), then redeploy so the build picks them up. Never put the database password in the repository — only in Vercel and in your local `.env`. With a single project and no `VITE_GUEST_URL`, the guest app lives at `/guest` on the same site.

The live SMS moment (`/stage`) needs the long-running local server, so it is hidden on Vercel; run it from the presenting laptop with `npm start`, or on a Node/Docker host (`render.yaml` and the `Dockerfile` are included).

Browser system notifications require **HTTPS** (Vercel has it). Over plain HTTP the guest app still alerts in-app with a chime and vibration.

**Always keep a fallback:** run `npm run build && npm start` on the presenting laptop, and record a screen capture of the 30-second demo in case the venue Wi-Fi fails.
