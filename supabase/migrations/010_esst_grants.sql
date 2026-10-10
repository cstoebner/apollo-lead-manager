-- Run this in the Supabase SQL editor after reviewing it.
-- 009_esst_tracking.sql created the tables but never granted privileges on
-- them, so the app's signed-in role got "permission denied" trying to read
-- them at all -- which broke the whole app, since loadWorkspaceData queries
-- every table in one batch and fails entirely if any single query errors.
grant select, insert, update, delete on public.esst_hours_entries to authenticated, anon;
grant select, insert, update, delete on public.esst_usage_entries to authenticated, anon;
