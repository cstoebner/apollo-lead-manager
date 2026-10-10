-- Run this in the Supabase SQL editor after reviewing it.
-- Acuity has one free-trial appointment type per instrument, so the booking
-- link needs the right type id for each lead's instrument. Adding a new
-- instrument/type later is just inserting a row here -- no code change.
create table if not exists public.acuity_appointment_types (
  instrument text primary key,
  appointment_type_id text not null
);

insert into public.acuity_appointment_types (instrument, appointment_type_id) values
  ('Piano', '93643295'),
  ('Guitar', '93655035'),
  ('Voice', '93655274'),
  ('Drums', '93655206'),
  ('Trumpet', '93655494'),
  ('Trombone', '93655494'),
  ('Saxophone', '94539008'),
  ('Flute', '94539008'),
  ('Clarinet', '94539008'),
  ('Ukulele', '95470186')
on conflict (instrument) do update set appointment_type_id = excluded.appointment_type_id;

grant select on public.acuity_appointment_types to authenticated, anon;
grant select, insert, update, delete on public.acuity_appointment_types to service_role;
