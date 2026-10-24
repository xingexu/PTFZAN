alter table fhn.hotel_control add column auto_approve_until double precision not null default 0;
comment on column fhn.hotel_control.auto_approve_until is 'How far a stopped 30-second demo got: plans before this minute count as approved, as the demo approved them.';
