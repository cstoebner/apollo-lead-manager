-- Run this in the Supabase SQL editor after reviewing it.
-- Acuity/Stripe trial-booking integration. Follows the no-RLS, plain-grant
-- convention used by every table since 004 (see 009/010) rather than the
-- owner_id-scoped RLS from 001 -- this app is single-operator in practice
-- and that's the pattern every later feature has actually used.
--
-- All writes to these four tables happen server-side (Cloudflare Pages
-- Functions, using the Supabase service-role key, which bypasses grants
-- entirely) because every write here is paired with a call to Acuity or
-- Stripe using a secret that must never reach the browser. The client only
-- ever reads them, so it only gets select.

alter table public.instructors add column if not exists acuity_calendar_id text;

create table if not exists public.holds (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  instructor_id uuid not null references public.instructors(id) on delete cascade,
  starts_at timestamptz not null,
  duration_minutes integer not null default 30,
  booking_link text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'expired', 'confirmed', 'unmatched')),
  acuity_appointment_id text
);
create index if not exists holds_lead_idx on public.holds(lead_id);
create index if not exists holds_instructor_starts_idx on public.holds(instructor_id, starts_at);
create index if not exists holds_status_expires_idx on public.holds(status, expires_at);

create table if not exists public.acuity_blocks (
  id uuid primary key default gen_random_uuid(),
  acuity_block_id text not null,
  instructor_id uuid not null references public.instructors(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index if not exists acuity_blocks_instructor_idx on public.acuity_blocks(instructor_id, starts_at);

create table if not exists public.acuity_events (
  id uuid primary key default gen_random_uuid(),
  acuity_appointment_id text,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now()
);
create index if not exists acuity_events_appointment_idx on public.acuity_events(acuity_appointment_id);

-- One row per attempted $40 charge. idempotency_key is unique so a
-- double-click (or a retried request) can never charge the same
-- cancellation/no-show twice.
create table if not exists public.fee_charges (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  acuity_appointment_id text,
  amount_cents integer not null,
  reason text not null check (reason in ('no_show', 'late_cancel')),
  idempotency_key text not null unique,
  status text not null check (status in ('succeeded', 'failed', 'waived')),
  stripe_payment_intent_id text,
  failure_message text,
  waived_reason text,
  created_at timestamptz not null default now()
);
create index if not exists fee_charges_lead_idx on public.fee_charges(lead_id);

grant select on public.holds, public.acuity_blocks, public.acuity_events, public.fee_charges to authenticated, anon;
