-- FHN AI's check-in decision, as plain columns (the full plan, with its reasons, stays in `plan`).
alter table fhn.guests
  add column room_id text,
  add column attendant text,
  add column ready_at timestamptz,
  add column promised_at timestamptz;
comment on column fhn.guests.room_id is 'Room FHN AI chose at check-in (server side, one check-in at a time).';
comment on column fhn.guests.attendant is 'Attendant assigned to clean the room.';
comment on column fhn.guests.ready_at is 'When the room is ready (cleaned and checked).';
comment on column fhn.guests.promised_at is 'The time promised to the guest: the late end of the forecast window.';
update fhn.guests set room_id = plan->>'roomId' where plan is not null and room_id is null;
-- Finding the guests who still hold a room, at every check-in.
create index if not exists guests_checked_in_idx on fhn.guests (checked_in_at) where plan is not null;
