-- Run this in the Supabase SQL editor after reviewing it.
-- Every row is owned by the signed-in user. RLS prevents one account from
-- reading or changing another account's leads.

create type public.lead_status as enum ('active_student', 'hot', 'nurture', 'nurture_long_term', 'unresponsive');
create type public.activity_type as enum ('call', 'text', 'email', 'note', 'status_change');

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  phone text not null default '',
  email text not null default '',
  instrument text not null default '',
  received_at timestamptz not null default now(),
  source text not null default 'Manual entry',
  campaign text not null default '',
  status public.lead_status not null default 'hot',
  trial_at timestamptz,
  hold_form_complete boolean not null default false,
  trial_attended boolean not null default false,
  enrolled_at timestamptz,
  ad_cost numeric(10,2) not null default 0 check (ad_cost >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  type public.activity_type not null,
  occurred_at timestamptz not null default now(),
  outcome text not null default '',
  created_at timestamptz not null default now()
);

create table public.availability (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  weekday_start time not null default '16:30',
  weekday_end time not null default '20:00',
  weekend_start time not null default '10:00',
  weekend_end time not null default '16:00',
  tuesday_blackout_start time not null default '17:00',
  tuesday_blackout_end time not null default '17:30',
  thursday_blackout_start time not null default '16:30',
  thursday_blackout_end time not null default '17:30',
  avoid_major_holidays boolean not null default true,
  allow_weekends boolean not null default true,
  updated_at timestamptz not null default now()
);

create index leads_owner_received_idx on public.leads(owner_id, received_at desc);
create index activities_lead_occurred_idx on public.activities(lead_id, occurred_at desc);

alter table public.leads enable row level security;
alter table public.activities enable row level security;
alter table public.availability enable row level security;

create policy "owners manage their leads" on public.leads
  for all to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "owners manage activities for their leads" on public.activities
  for all to authenticated
  using (
    (select auth.uid()) = owner_id and exists (
      select 1 from public.leads where leads.id = activities.lead_id and leads.owner_id = (select auth.uid())
    )
  )
  with check (
    (select auth.uid()) = owner_id and exists (
      select 1 from public.leads where leads.id = activities.lead_id and leads.owner_id = (select auth.uid())
    )
  );

create policy "owners manage availability" on public.availability
  for all to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

revoke all on table public.leads, public.activities, public.availability from anon;
grant select, insert, update, delete on table public.leads, public.activities, public.availability to authenticated;
