-- Run this in the Supabase SQL editor after reviewing it.
-- The Acuity/Stripe Cloudflare Functions (011_acuity_integration.sql) are the
-- first thing in this app to query Supabase with the service_role key rather
-- than the client's anon/authenticated key. Every pre-existing table they
-- touch was only ever granted to authenticated/anon, never service_role, so
-- those queries fail with "permission denied for table X" -- caught live
-- while testing the nightly reconciliation route against production.
grant select, insert, update, delete on public.instructors, public.leads, public.activities, public.trial_openings, public.schedule_entries to service_role;
