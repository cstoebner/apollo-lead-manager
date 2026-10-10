-- Run this in the Supabase SQL editor after reviewing it.
-- Links sibling leads (e.g. two kids from the same parent) that share
-- contact info but need fully independent trial/enrollment tracking.
alter table public.leads add column if not exists household_id uuid;
create index if not exists leads_household_idx on public.leads(household_id) where household_id is not null;
