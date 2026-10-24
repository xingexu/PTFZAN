// Where everything is saved: Postgres when DATABASE_URL is set (the Supabase project in production),
// otherwise in memory for a quick local run. Guest stays, and the shared hotel day.
import postgres from 'postgres';
import type { Plan, Stay } from '../../shared/guest/stay.js';
import { initialControl, type Control, type TimelineEvent } from '../../shared/sim/timeline.js';
import type { Metrics } from '../../shared/types.js';

export interface ActivityItem {
  id: number;
  at: number;
  kind: string;
  text: string;
}

/** One room as the live hotel table stores it. */
export interface RoomRow {
  id: string;
  floor: number;
  type: string;
  wedding: boolean;
  status: string;
  ready_at_minute: number | null;
  eta_low: number | null;
  eta_high: number | null;
  eta_confidence: string | null;
  hvac: string;
  attendant: string | null;
}

/** The shared hotel day at a glance, as the server last computed it. */
export interface HotelSnapshot {
  run: number;
  mode: string;
  minute: number;
  clock: string;
  playing: boolean;
  finished: boolean;
  metrics: Metrics;
  compareMetrics: Metrics | null;
  log: unknown[];
  rooms: RoomRow[];
}

export interface HotelStore {
  control(): Promise<Control>;
  /** Saves `next` only if nobody else changed the control since `expectVersion`; null on a clash. */
  setControl(next: Control, expectVersion: number): Promise<Control | null>;
  addEvent(e: Omit<TimelineEvent, 'id'>): Promise<TimelineEvent>;
  events(run: number, after: number): Promise<TimelineEvent[]>;
  /** Marks a screen as watching; returns how many screens are watching now. */
  seen(viewer: string): Promise<number>;
  /** True for at most one caller every `everyMs` — that caller refreshes the live tables. */
  claimSnapshot(everyMs: number): Promise<boolean>;
  writeSnapshot(s: HotelSnapshot): Promise<void>;
}

export interface Store {
  readonly kind: 'postgres' | 'memory';
  readonly hotel: HotelStore;
  create(stay: Omit<Stay, 'id'>): Promise<Stay>;
  get(id: string): Promise<Stay | null>;
  /** Saves the guest's changes and any requests added since `knownRequests`. */
  save(stay: Stay, knownRequests: number): Promise<void>;
  remove(id: string): Promise<void>;
  log(guestId: string, kind: string, text: string, at: number): Promise<void>;
  activity(after: number, limit: number): Promise<ActivityItem[]>;
  counts(since: number): Promise<{ registered: number; checkedIn: number }>;
}

// ───────── Postgres ─────────
interface GuestRow {
  id: string;
  code: string;
  name: string;
  email: string | null;
  party: number;
  created_at: Date;
  checked_in_at: Date | null;
  in_room_at: Date | null;
  plan: Plan | null;
  housekeeping: Stay['housekeeping'];
  setpoint: number;
  away_until: Date | null;
  notify_browser: boolean;
}
interface RequestRow {
  n: number;
  kind: 'issue' | 'amenity';
  title: string;
  created_at: Date;
}

const ms = (d: Date | null) => (d ? d.getTime() : undefined);
const date = (n?: number) => (n === undefined ? null : new Date(n));

const toStay = (g: GuestRow, reqs: RequestRow[]): Stay => ({
  id: g.id,
  code: g.code,
  name: g.name,
  email: g.email ?? undefined,
  party: g.party,
  createdAt: g.created_at.getTime(),
  checkInAt: ms(g.checked_in_at),
  plan: g.plan ?? undefined,
  inRoomAt: ms(g.in_room_at),
  housekeeping: g.housekeeping,
  setpoint: g.setpoint,
  awayUntil: ms(g.away_until),
  notifyBrowser: g.notify_browser,
  requests: reqs.map((r) => ({ id: `RQ-${r.n}`, n: r.n, kind: r.kind, title: r.title, at: r.created_at.getTime() })),
});

interface ControlRow {
  run: number;
  mode: Control['mode'];
  auto_approve_at_start: boolean;
  auto_approve: boolean;
  playing: boolean;
  speed: number;
  autopilot: boolean;
  auto_approve_until: number;
  anchor_minute: number;
  anchor_ms: string;
  version: number;
}
const toControl = (r: ControlRow): Control => ({
  run: r.run, mode: r.mode, autoApproveAtStart: r.auto_approve_at_start, autoApprove: r.auto_approve, playing: r.playing,
  speed: r.speed, autopilot: r.autopilot, autoApproveUntil: Number(r.auto_approve_until), anchorMinute: Number(r.anchor_minute),
  anchorMs: Number(r.anchor_ms), version: r.version,
});
interface EventRow {
  id: string;
  run: number;
  minute: number;
  kind: TimelineEvent['kind'];
  data: Record<string, unknown>;
}
const toEvent = (r: EventRow): TimelineEvent => ({ id: Number(r.id), run: r.run, minute: r.minute, kind: r.kind, data: r.data });

function postgresHotel(sql: postgres.Sql): HotelStore {
  return {
    async control() {
      const [r] = await sql<ControlRow[]>`select * from fhn.hotel_control where id = 'main'`;
      if (r) return toControl(r);
      await sql`insert into fhn.hotel_control (id, anchor_ms) values ('main', ${Date.now()}) on conflict do nothing`;
      return toControl((await sql<ControlRow[]>`select * from fhn.hotel_control where id = 'main'`)[0]);
    },
    async setControl(c, expectVersion) {
      const [r] = await sql<ControlRow[]>`
        update fhn.hotel_control set
          run = ${c.run}, mode = ${c.mode}, auto_approve_at_start = ${c.autoApproveAtStart}, auto_approve = ${c.autoApprove},
          playing = ${c.playing}, speed = ${c.speed}, autopilot = ${c.autopilot}, auto_approve_until = ${c.autoApproveUntil}, anchor_minute = ${c.anchorMinute},
          anchor_ms = ${c.anchorMs}, version = ${c.version}, updated_at = now()
        where id = 'main' and version = ${expectVersion}
        returning *`;
      return r ? toControl(r) : null;
    },
    async addEvent(e) {
      const [r] = await sql<EventRow[]>`
        insert into fhn.hotel_events (run, minute, kind, data)
        values (${e.run}, ${e.minute}, ${e.kind}, ${sql.json(e.data as postgres.JSONValue)})
        returning id, run, minute, kind, data`;
      return toEvent(r);
    },
    async events(run, after) {
      const rows = await sql<EventRow[]>`select id, run, minute, kind, data from fhn.hotel_events where run = ${run} and id > ${after} order by id`;
      return rows.map(toEvent);
    },
    async seen(viewer) {
      const [r] = await sql<{ n: number }[]>`
        with up as (
          insert into fhn.hotel_viewers (id, last_seen) values (${viewer}, now())
          on conflict (id) do update set last_seen = now()
          returning id
        )
        select (select count(*)::int from fhn.hotel_viewers where last_seen > now() - interval '15 seconds' and id <> ${viewer}) + 1 as n`;
      return r.n;
    },
    async claimSnapshot(everyMs) {
      const rows = await sql`
        update fhn.hotel_control set snapshot_at = now()
        where id = 'main' and (snapshot_at is null or snapshot_at < now() - ${`${everyMs} milliseconds`}::interval)
        returning id`;
      return rows.length > 0;
    },
    async writeSnapshot(s) {
      await sql.begin(async (tx) => {
        await tx`
          insert into fhn.rooms ${tx(s.rooms, 'id', 'floor', 'type', 'wedding', 'status', 'ready_at_minute', 'eta_low', 'eta_high', 'eta_confidence', 'hvac', 'attendant')}
          on conflict (id) do update set
            floor = excluded.floor, type = excluded.type, wedding = excluded.wedding, status = excluded.status,
            ready_at_minute = excluded.ready_at_minute, eta_low = excluded.eta_low, eta_high = excluded.eta_high,
            eta_confidence = excluded.eta_confidence, hvac = excluded.hvac, attendant = excluded.attendant, updated_at = now()`;
        await tx`
          insert into fhn.hotel_snapshot (id, run, mode, minute, clock, playing, finished, metrics, compare_metrics, log, updated_at)
          values ('main', ${s.run}, ${s.mode}, ${s.minute}, ${s.clock}, ${s.playing}, ${s.finished},
            ${tx.json(s.metrics as unknown as postgres.JSONValue)}, ${s.compareMetrics ? tx.json(s.compareMetrics as unknown as postgres.JSONValue) : null},
            ${tx.json(s.log as postgres.JSONValue)}, now())
          on conflict (id) do update set
            run = excluded.run, mode = excluded.mode, minute = excluded.minute, clock = excluded.clock, playing = excluded.playing,
            finished = excluded.finished, metrics = excluded.metrics, compare_metrics = excluded.compare_metrics, log = excluded.log, updated_at = now()`;
        await tx`delete from fhn.hotel_viewers where last_seen < now() - interval '1 day'`;
      });
    },
  };
}

function postgresStore(url: string): Store {
  // One connection per function instance, through Supabase's transaction pooler (no prepared statements).
  const sql = postgres(url, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10 });
  return {
    kind: 'postgres',
    hotel: postgresHotel(sql),
    async create(s) {
      const [g] = await sql<GuestRow[]>`
        insert into fhn.guests (code, name, email, party, created_at, housekeeping, setpoint)
        values (${s.code}, ${s.name}, ${s.email ?? null}, ${s.party}, ${new Date(s.createdAt)}, ${s.housekeeping}, ${s.setpoint})
        returning *`;
      return toStay(g, []);
    },
    async get(id) {
      const [g] = await sql<GuestRow[]>`select * from fhn.guests where id = ${id}`;
      if (!g) return null;
      const reqs = await sql<RequestRow[]>`select n, kind, title, created_at from fhn.requests where guest_id = ${id} order by n`;
      return toStay(g, reqs);
    },
    async save(s, knownRequests) {
      const added = s.requests.slice(knownRequests);
      await sql.begin(async (tx) => {
        await tx`
          update fhn.guests set
            checked_in_at = ${date(s.checkInAt)}, in_room_at = ${date(s.inRoomAt)},
            plan = ${s.plan ? tx.json(s.plan as unknown as postgres.JSONValue) : null},
            housekeeping = ${s.housekeeping}, setpoint = ${s.setpoint}, away_until = ${date(s.awayUntil)},
            notify_browser = ${!!s.notifyBrowser}
          where id = ${s.id}`;
        for (const r of added)
          await tx`insert into fhn.requests (guest_id, n, kind, title, created_at) values (${s.id}, ${r.n}, ${r.kind}, ${r.title}, ${new Date(r.at)})`;
      });
    },
    async remove(id) {
      await sql`delete from fhn.guests where id = ${id}`;
    },
    async log(guestId, kind, text, at) {
      await sql`insert into fhn.activity (guest_id, kind, text, at) values (${guestId}, ${kind}, ${text}, ${new Date(at)})`;
    },
    async activity(after, limit) {
      const rows = await sql<{ id: string; at: Date; kind: string; text: string }[]>`
        select id, at, kind, text from fhn.activity where id > ${after} order by id desc limit ${limit}`;
      return rows.map((r) => ({ id: Number(r.id), at: r.at.getTime(), kind: r.kind, text: r.text }));
    },
    async counts(since) {
      const [c] = await sql<{ registered: number; checked_in: number }[]>`
        select count(*)::int as registered, count(checked_in_at)::int as checked_in from fhn.guests where created_at > ${new Date(since)}`;
      return { registered: c.registered, checkedIn: c.checked_in };
    },
  };
}

// ───────── Memory (local runs without a database) ─────────
function memoryHotel(): HotelStore {
  let control = initialControl(Date.now());
  const events: TimelineEvent[] = [];
  const viewers = new Map<string, number>();
  let snapshotAt = 0;
  let eventSeq = 0;
  return {
    async control() {
      return { ...control };
    },
    async setControl(c, expectVersion) {
      if (control.version !== expectVersion) return null;
      control = { ...c };
      return { ...control };
    },
    async addEvent(e) {
      const ev = { ...e, id: ++eventSeq };
      events.push(ev);
      return ev;
    },
    async events(run, after) {
      return events.filter((e) => e.run === run && e.id > after);
    },
    async seen(viewer) {
      const now = Date.now();
      viewers.set(viewer, now);
      return [...viewers.values()].filter((t) => now - t < 15000).length;
    },
    async claimSnapshot(everyMs) {
      if (Date.now() - snapshotAt < everyMs) return false;
      snapshotAt = Date.now();
      return true;
    },
    async writeSnapshot() {
      /* nothing to persist without a database */
    },
  };
}

function memoryStore(): Store {
  const guests = new Map<string, Stay>();
  const log: (ActivityItem & { guestId: string })[] = [];
  let seq = 0;
  const copy = (s: Stay): Stay => structuredClone(s);
  return {
    kind: 'memory',
    hotel: memoryHotel(),
    async create(s) {
      const stay = { ...copy(s as Stay), id: crypto.randomUUID() };
      guests.set(stay.id, stay);
      return copy(stay);
    },
    async get(id) {
      const s = guests.get(id);
      return s ? copy(s) : null;
    },
    async save(s) {
      guests.set(s.id, copy(s));
    },
    async remove(id) {
      guests.delete(id);
      for (let i = log.length - 1; i >= 0; i--) if (log[i].guestId === id) log.splice(i, 1);
    },
    async log(guestId, kind, text, at) {
      log.push({ id: ++seq, guestId, kind, text, at });
      if (log.length > 500) log.shift();
    },
    async activity(after, limit) {
      return log.filter((l) => l.id > after).slice(-limit).reverse().map(({ guestId: _, ...l }) => l);
    },
    async counts(since) {
      const recent = [...guests.values()].filter((g) => g.createdAt > since);
      return { registered: recent.length, checkedIn: recent.filter((g) => g.checkInAt).length };
    },
  };
}

let current: Store | null = null;
export const store = () => (current ??= process.env.DATABASE_URL ? postgresStore(process.env.DATABASE_URL) : memoryStore());
