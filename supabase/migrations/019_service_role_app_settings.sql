-- Run this in the Supabase SQL editor after reviewing it.
-- Lead intake runs server-side and reads the owner id, offered instruments, saved message templates and the
-- auto-send switch from app_settings, so the service_role needs to be able to read it (see 012).
grant select on public.app_settings to service_role;
