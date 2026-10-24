// Where guest stays are saved: Postgres when DATABASE_URL is set (the Supabase project in production),
// otherwise in memory for a quick local run.
import postgres from 'postgres';
import type { Plan, Stay } from '../../shared/guest/stay.js';

export interface ActivityItem {
  id: number;
  at: number;
  kind: string;
  text: string;
}

export interface Store {
  readonly kind: 'postgres' | 'memory';
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

function postgresStore(url: string): Store {
  // One connection per function instance, through Supabase's transaction pooler (no prepared statements).
  const sql = postgres(url, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10 });
  return {
    kind: 'postgres',
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
function memoryStore(): Store {
  const guests = new Map<string, Stay>();
  const log: (ActivityItem & { guestId: string })[] = [];
  let seq = 0;
  const copy = (s: Stay): Stay => structuredClone(s);
  return {
    kind: 'memory',
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
