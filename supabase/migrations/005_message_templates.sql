-- Run this in the Supabase SQL editor after reviewing it.
alter table public.app_settings add column if not exists message_templates jsonb;
