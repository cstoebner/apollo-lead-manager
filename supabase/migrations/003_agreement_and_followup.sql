-- Run this in the Supabase SQL editor after reviewing it.
alter table public.leads add column if not exists enrollment_agreement_signed boolean not null default false;
alter table public.leads add column if not exists follow_up_at timestamptz;
alter table public.leads add column if not exists follow_up_note text;
