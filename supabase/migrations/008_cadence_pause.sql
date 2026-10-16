-- Run this in the Supabase SQL editor after reviewing it.
-- Supports pausing a lead's outreach/nurture cadence and resuming it
-- later at the same point, instead of the clock just running past it.
alter table public.leads add column if not exists cadence_shift_days numeric;
alter table public.leads add column if not exists cadence_pause_until timestamptz;
alter table public.leads add column if not exists cadence_pause_started_at timestamptz;
