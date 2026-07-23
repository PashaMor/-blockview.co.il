-- BlockView — seed the change-feed with the listings that are already live.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
-- Requires 31_building_events.sql.
--
-- The event trigger is forward-looking, so a building followed today shows an
-- empty feed until its next change. This one-time backfill records a 'new_listing'
-- event for every currently-approved listing, dated to when the listing was
-- created, so a fresh follower sees the real contents of the building.
--
-- SECURITY VERDICT — safe. Pure INSERT ... SELECT into building_events (RLS still
-- gates reads to followers/admins). No DDL, no privilege change, no dynamic SQL.
-- The `not exists` guard makes it idempotent — re-running adds nothing.

insert into public.building_events (building_id, listing_id, kind, meta, created_at)
select l.building_id,
       l.id::text,
       'new_listing',
       jsonb_build_object('title', l.title, 'price', l.price),
       l.created_at
from   public.listings l
where  l.status = 'approved'
  and  not exists (
    select 1 from public.building_events e
    where e.listing_id = l.id::text and e.kind = 'new_listing'
  );

select count(*) as new_listing_events from public.building_events where kind = 'new_listing';
