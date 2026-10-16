-- Run this in the Supabase SQL editor after reviewing it.
-- Adds the Violin and Viola free-trial appointment types created in Acuity.
insert into public.acuity_appointment_types (instrument, appointment_type_id) values
  ('Violin', '99233572'),
  ('Viola', '99237904')
on conflict (instrument) do update set appointment_type_id = excluded.appointment_type_id;
