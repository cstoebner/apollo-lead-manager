-- Run this in the Supabase SQL editor after reviewing it.
-- Remembers when the weekly data backup (Today page) was last downloaded, so the reminder works from any device.
alter table public.app_settings add column if not exists last_backup_at timestamptz;
