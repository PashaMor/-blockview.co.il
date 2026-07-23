-- BlockView — when a listing is removed, remove its building if nothing is left.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- Deleting a listing used to leave its building behind as an empty shell on the
-- map ("0 נכסים"). Now, when a listing is deleted, its building is deleted too —
-- BUT only if:
--   * no other listing still points at that building (so a shared building, where
--     someone else has a property, is kept — the location is preserved); and
--   * the building was created from a listing (created_by is set), never one of
--     the trusted hand-seeded buildings (created_by is null).
--
-- SECURITY: SECURITY DEFINER with search_path pinned, because buildings_delete
-- is admin-only — a regular agent deleting their own listing must still be able
-- to clean up the now-empty building. It cannot be abused to delete a building
-- that holds someone else's listing (the "no listings remain" check blocks that),
-- and it only ever fires as a side effect of deleting a listing.

create or replace function public.cleanup_orphan_building()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.listings where building_id = old.building_id) then
    delete from public.buildings
     where id = old.building_id
       and created_by is not null;      -- seeds (created_by null) are never auto-removed
  end if;
  return old;
end $$;

drop trigger if exists listings_cleanup_building on public.listings;
create trigger listings_cleanup_building
  after delete on public.listings
  for each row execute procedure public.cleanup_orphan_building();

-- one-time: clear buildings that are already orphaned (user-created, no listings)
delete from public.buildings b
 where b.created_by is not null
   and not exists (select 1 from public.listings l where l.building_id = b.id);

select 'orphan-building cleanup wired; existing orphans removed' as note;
