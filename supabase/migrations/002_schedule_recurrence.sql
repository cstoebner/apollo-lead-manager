-- Run this in the Supabase SQL editor before deploying the biweekly-recurrence update.
-- Adds the column that lets a regular schedule entry repeat every other week instead of every week.
-- Existing rows default to 1 (weekly), so nothing about current schedules changes.

alter table public.schedule_entries
  add column if not exists repeat_interval_weeks integer not null default 1
  check (repeat_interval_weeks in (1, 2));
