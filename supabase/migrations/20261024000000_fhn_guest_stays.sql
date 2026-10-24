-- FHN AI demo: guest stays and what guests do in the app (Supabase project "fhn-ai", ca-central-1).
-- Kept in its own schema, which the Supabase Data API does not expose; the app connects as fhn_app.
create schema if not exists fhn;

create table fhn.guests (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null check (char_length(name) between 1 and 40),
  email text check (email is null or char_length(email) <= 120),
  party smallint not null default 1 check (party between 1 and 4),
  created_at timestamptz not null default now(),
  checked_in_at timestamptz,
  in_room_at timestamptz,
  plan jsonb,
  housekeeping text not null default 'standard' check (housekeeping in ('standard', 'green', 'dnd')),
  setpoint smallint not null default 21 check (setpoint between 18 and 25),
  away_until timestamptz,
  notify_browser boolean not null default false
);
comment on table fhn.guests is 'One row per guest who registered in the guest app. plan = the room and calculated wait set at check-in.';
create index guests_created_idx on fhn.guests (created_at desc);

create table fhn.requests (
  id bigint generated always as identity primary key,
  guest_id uuid not null references fhn.guests (id) on delete cascade,
  n integer not null,
  kind text not null check (kind in ('issue', 'amenity')),
  title text not null check (char_length(title) between 1 and 40),
  created_at timestamptz not null default now(),
  constraint requests_guest_n_key unique (guest_id, n)
);
create index requests_guest_idx on fhn.requests (guest_id);

create table fhn.activity (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  guest_id uuid references fhn.guests (id) on delete cascade,
  kind text not null,
  text text not null
);
create index activity_at_idx on fhn.activity (at desc);
comment on table fhn.activity is 'What guests did in the app, shown on the hotel screen (first names only).';

revoke all on schema fhn from public;
revoke all on all tables in schema fhn from anon, authenticated;

-- The login the app uses: only these tables. Set its password separately (never in this file), e.g.
--   alter role fhn_app with password '<long random password>';
-- then connect through the transaction pooler as fhn_app.<project-ref> on port 6543.
create role fhn_app with login connection limit 40;
grant usage on schema fhn to fhn_app;
grant select, insert, update, delete on fhn.guests, fhn.requests, fhn.activity to fhn_app;
alter role fhn_app set search_path = fhn;
alter role fhn_app set statement_timeout = '8s';
