-- Run this in the Supabase SQL editor after reviewing it.
alter table public.leads add column if not exists instruments text[] not null default '{}';
update public.leads set instruments = array[instrument] where (instruments is null or instruments = '{}') and instrument is not null and instrument <> '';
