-- Run this in the Supabase SQL editor after reviewing it.
-- Leads who did not opt in to text messages on their form still get the initial outreach but are kept out of the nurture campaign.
alter table public.leads add column if not exists sms_opt_out boolean not null default false;
