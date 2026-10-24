-- The hotel day, shared by every screen.
-- hotel_control: the one clock and playback state (a single row).
create table fhn.hotel_control (
  id text primary key default 'main' check (id = 'main'),
  run integer not null default 1,
  mode text not null default 'ai' check (mode in ('ai', 'baseline')),
  auto_approve_at_start boolean not null default false,
  auto_approve boolean not null default false,
  playing boolean not null default false,
  speed smallint not null default 10 check (speed in (5, 10, 20, 30, 60)),
  autopilot boolean not null default false,
  anchor_minute double precision not null default 480,
  anchor_ms bigint not null default 0,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  snapshot_at timestamptz
);
comment on table fhn.hotel_control is 'The shared hotel clock: every screen rebuilds the same day from this row and fhn.hotel_events.';
insert into fhn.hotel_control (id) values ('main');

-- hotel_events: every decision made on any screen, in order (plan approvals, problem reports).
create table fhn.hotel_events (
  id bigint generated always as identity primary key,
  run integer not null,
  minute integer not null check (minute between 480 and 1021),
  kind text not null check (kind in ('approve', 'dismiss', 'issue', 'auto-approve')),
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index hotel_events_run_idx on fhn.hotel_events (run, id);

-- rooms and hotel_snapshot: the live hotel, written by the server as the shared day plays.
create table fhn.rooms (
  id text primary key,
  floor smallint not null,
  type text not null,
  wedding boolean not null default false,
  status text not null,
  ready_at_minute integer,
  eta_low integer,
  eta_high integer,
  eta_confidence text,
  hvac text not null,
  attendant text,
  updated_at timestamptz not null default now()
);
comment on table fhn.rooms is 'Live status of every room in the shared hotel day (status, expected ready time, temperature mode).';

create table fhn.hotel_snapshot (
  id text primary key default 'main' check (id = 'main'),
  run integer not null,
  mode text not null,
  minute integer not null,
  clock text not null,
  playing boolean not null,
  finished boolean not null,
  metrics jsonb not null,
  compare_metrics jsonb,
  log jsonb not null default '[]',
  updated_at timestamptz not null default now()
);
comment on table fhn.hotel_snapshot is 'The shared hotel day at a glance: clock, both sides of the comparison, and the latest log.';

-- hotel_viewers: screens that have the hotel view open (for "synced · N screens").
create table fhn.hotel_viewers (
  id text primary key check (char_length(id) between 8 and 40),
  last_seen timestamptz not null default now()
);

revoke all on fhn.hotel_control, fhn.hotel_events, fhn.rooms, fhn.hotel_snapshot, fhn.hotel_viewers from anon, authenticated;
grant select, insert, update, delete on fhn.hotel_control, fhn.hotel_events, fhn.rooms, fhn.hotel_snapshot, fhn.hotel_viewers to fhn_app;
