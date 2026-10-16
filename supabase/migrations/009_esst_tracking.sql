-- Run this in the Supabase SQL editor after reviewing it.
-- Minnesota Earned Sick and Safe Time (ESST) tracking: hours worked per pay
-- period (drives accrual at 1 hour per 30 worked, capped at 80 balance) and
-- discrete hours-taken entries. Balance is always derived live from these two
-- logs, never stored, so there is nothing here to keep in sync by hand.

alter table public.instructors add column if not exists esst_eligible boolean not null default true;

create table if not exists public.esst_hours_entries (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.instructors(id) on delete cascade,
  period_ends_on date not null,
  hours_worked numeric not null check (hours_worked >= 0),
  created_at timestamptz not null default now()
);
create index if not exists esst_hours_entries_instructor_idx on public.esst_hours_entries(instructor_id, period_ends_on);

create table if not exists public.esst_usage_entries (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.instructors(id) on delete cascade,
  used_on date not null,
  hours numeric not null check (hours > 0),
  created_at timestamptz not null default now()
);
create index if not exists esst_usage_entries_instructor_idx on public.esst_usage_entries(instructor_id, used_on);
