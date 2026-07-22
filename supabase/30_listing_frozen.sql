-- BlockView — add a 'frozen' listing status (מוקפא): temporarily off the map,
-- not rejected, not deleted. Run in Supabase: SQL Editor -> paste -> Run.
-- Safe to re-run.
--
-- The map only ever shows 'approved' listings, so a frozen one is hidden with
-- no other change needed. 'draft' and 'sold' are dropped from the pickers in the
-- UI; no listing currently uses either, so nothing is stranded. They stay
-- ALLOWED by the constraint below (harmless, and it means an older row or a
-- concurrent write can't fail the migration) — they simply aren't offered.

alter table public.listings drop constraint if exists listings_status_check;
alter table public.listings drop constraint if exists listings_status_chk;
do $$ begin
  alter table public.listings add constraint listings_status_chk
    check (status in ('draft','pending','approved','rejected','sold','frozen'));
exception when duplicate_object then null; end $$;

select status, count(*) from public.listings group by status order by status;
