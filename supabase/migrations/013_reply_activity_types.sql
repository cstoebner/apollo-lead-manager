-- Run this in the Supabase SQL editor after reviewing it.
-- activities.type is plain text guarded by a CHECK constraint (confirmed by
-- introspecting production). Adds text_received and call_received for the
-- "Text received" / "Call received" logging. Replaces whichever check
-- constraint currently guards the type column; if any existing row has a type
-- outside the list below, the whole block errors and rolls back unchanged.
do $$
declare c record;
begin
  for c in
    select con.conname from pg_constraint con
    where con.conrelid = 'public.activities'::regclass and con.contype = 'c'
      and con.conkey = array[(select attnum from pg_attribute where attrelid = 'public.activities'::regclass and attname = 'type')]
  loop
    execute format('alter table public.activities drop constraint %I', c.conname);
  end loop;
  alter table public.activities add constraint activities_type_check
    check (type = any (array['call','text','email','note','status_change','trial_update','lead_created','lead_update','text_received','call_received']));
end $$;
