-- Run this in the Supabase SQL editor after reviewing it.
-- The schedule_entries check constraints were never updated to match
-- the app's actual TypeScript types:
--   - kind is missing 'vacation' (new instructor-vacation feature)
--   - duration_minutes is missing 15 (used by auto-scheduled breaks,
--     and 1440 for a vacation day) and 1440 (a full day, for vacation)
alter table public.schedule_entries drop constraint if exists schedule_entries_kind_check;
alter table public.schedule_entries add constraint schedule_entries_kind_check
  check (kind = any (array['regular', 'trial', 'one_time', 'break', 'vacation']));

alter table public.schedule_entries drop constraint if exists schedule_entries_duration_minutes_check;
alter table public.schedule_entries add constraint schedule_entries_duration_minutes_check
  check (duration_minutes = any (array[15, 30, 45, 60, 1440]));
