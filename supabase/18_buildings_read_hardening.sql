-- BlockView — stop anon from reading unverified buildings off the raw table.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- 17_buildings_from_address.sql let any signed-in user create a building from an
-- address, and correctly kept unverified ones off the map via the
-- `buildings_visible` view. But the base table policy was still:
--
--     create policy buildings_read on public.buildings for select using (true);
--
-- A view is a UI-level filter, not a boundary: anyone with the publishable key
-- could skip it and GET /rest/v1/buildings to enumerate every unverified row —
-- including names/addresses a spammer invented. This aligns the TABLE with the
-- view, so the filter holds no matter which path the client takes.

drop policy if exists buildings_read on public.buildings;

create policy buildings_read on public.buildings for select using (
      verified                                        -- trusted / admin-verified
  or  exists (select 1 from public.listings l         -- earned its place on the map
              where l.building_id = buildings.id and l.status = 'approved')
  or  created_by = auth.uid()                         -- my own, still pending
  or  public.is_admin()                               -- moderation queue
);

-- No recursion: listings_read does not reference buildings.
-- The 8 seeded buildings are verified = true, so the publish/CRM building
-- pickers are unaffected.

select count(*) as buildings_anon_can_see from public.buildings;
