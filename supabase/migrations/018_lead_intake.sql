-- Run this in the Supabase SQL editor after reviewing it.
-- Automatic lead intake: Meta leads (from the Google Sheet) and Formspree emails are sent to
-- /api/inbound/lead, which creates the lead and queues a Day 0 email. Two new tables hold the
-- intake log (also the duplicate-check queue) and the outgoing-email queue the Gmail script drains.
--
-- All writes happen server-side with the service_role key; the browser only reads (RLS select
-- policies for signed-in users, same as the Acuity tables).

create table if not exists public.inbound_leads (
  id uuid primary key default gen_random_uuid(),
  source text not null,                          -- 'meta' | 'formspree'
  external_id text not null unique,              -- sheet tab+row, or Gmail message id: makes retries idempotent
  received_at timestamptz not null,
  raw jsonb not null,                            -- exactly what the script sent
  parsed jsonb not null,                         -- the normalized lead fields
  status text not null check (status in ('created', 'needs_review', 'merged', 'failed', 'dismissed')),
  lead_id uuid references public.leads(id) on delete set null,          -- the lead this created
  matched_lead_id uuid references public.leads(id) on delete set null, -- the existing lead it may duplicate
  match_reason text,
  note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists inbound_leads_status_idx on public.inbound_leads(status);

create table if not exists public.outbound_emails (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  inbound_lead_id uuid references public.inbound_leads(id) on delete set null,
  kind text not null default 'day0',
  to_email text not null,
  subject text not null,
  text_body text not null,
  html_body text not null,
  proposed_times jsonb,
  -- draft = waiting for you to approve; queued = ready for the Gmail script; sending = picked up by it
  status text not null check (status in ('draft', 'queued', 'sending', 'sent', 'failed', 'discarded')),
  error text,
  created_at timestamptz not null default now(),
  picked_at timestamptz,                        -- when the script last took it; a stuck 'sending' row is re-queued after a while
  sent_at timestamptz
);
create index if not exists outbound_emails_status_idx on public.outbound_emails(status);
create index if not exists outbound_emails_lead_idx on public.outbound_emails(lead_id);

-- false = every automatic email waits for your approval first (draft mode); true = sent straight away.
alter table public.app_settings add column if not exists intake_auto_send boolean not null default false;

alter table public.inbound_leads enable row level security;
alter table public.outbound_emails enable row level security;
drop policy if exists "signed-in users read inbound_leads" on public.inbound_leads;
create policy "signed-in users read inbound_leads" on public.inbound_leads for select to authenticated using (true);
drop policy if exists "signed-in users read outbound_emails" on public.outbound_emails;
create policy "signed-in users read outbound_emails" on public.outbound_emails for select to authenticated using (true);

grant select on public.inbound_leads, public.outbound_emails to authenticated;
grant select, insert, update, delete on public.inbound_leads, public.outbound_emails to service_role;
