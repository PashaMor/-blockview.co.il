-- BlockView — availability dates for rentals.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- A rental is available from a date; a short-term / sublet listing also has an
-- end date. The publish and CRM forms ask for these once a rent term is chosen.
--
-- SECURITY VERDICT — safe. Two nullable date columns + a sanity CHECK. No policy,
-- trigger or privilege change, no dynamic SQL.

alter table public.listings add column if not exists available_from date;
alter table public.listings add column if not exists available_to   date;

-- an end date, when present, cannot precede the start date
do $$ begin
  alter table public.listings add constraint listings_avail_range_chk
    check (available_to is null or available_from is null or available_to >= available_from);
exception when duplicate_object then null; end $$;

select 'rental availability dates added' as note;
