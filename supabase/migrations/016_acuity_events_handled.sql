-- Run this in the Supabase SQL editor after reviewing it.
-- Lets a booking/cancellation card in Action Pending disappear once Conor has
-- resolved it (confirmed, dismissed, etc.), on every device, after reloads.
-- Written only by the Cloudflare Functions (service_role); the app just reads it.
alter table public.acuity_events add column if not exists handled_at timestamptz;
alter table public.acuity_events add column if not exists handled_as text;
