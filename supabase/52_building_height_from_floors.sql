-- BlockView — let a listing's "floors total" set the 3D building height.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- Building heights come from OpenStreetMap, which often has NO floor/height data,
-- so a real 15-storey tower can render as a 5 m pancake. But the agent enters the
-- floor count (listings.floors_total). This uses that, agent knowledge over OSM:
-- when a listing's floors imply a TALLER building than we have, raise the building.
-- It only ever raises (greatest), so an accurate OSM height is never shortened by
-- a listing that happens to describe a low section.
--
-- SECURITY VERDICT — safe to run.
--   * raise_building_height_from_floors() is SECURITY DEFINER (so the trigger can
--     write the building past RLS) with search_path pinned to public. It only
--     touches buildings.height (non-sensitive) and cannot lower it or move it.
--   * No dynamic SQL, no policy/privilege change. Idempotent.

-- 1) trigger: on insert/edit, raise the building to fit the listing's floor count
create or replace function public.raise_building_height_from_floors()
returns trigger language plpgsql security definer set search_path = public as $$
declare h numeric;
begin
  if new.floors_total is not null and new.floors_total > 0 and new.building_id is not null then
    h := least(250, new.floors_total * 3.2);            -- ~3.2 m/floor; cap for sanity
    update public.buildings
       set height = greatest(coalesce(height, 0), h)
     where id = new.building_id
       and coalesce(height, 0) < h;                     -- only raise
  end if;
  return new;
end; $$;

drop trigger if exists trg_raise_height on public.listings;
create trigger trg_raise_height
  after insert or update of floors_total, building_id on public.listings
  for each row execute function public.raise_building_height_from_floors();

-- 2) backfill: apply it to every existing building from its listings' max floors
update public.buildings b
set    height = greatest(coalesce(b.height, 0), least(250, sub.maxfloors * 3.2))
from (
  select building_id, max(floors_total) as maxfloors
  from   public.listings
  where  floors_total is not null and floors_total > 0
  group  by building_id
) sub
where sub.building_id = b.id
  and coalesce(b.height, 0) < least(250, sub.maxfloors * 3.2);

select 'building heights now follow listing floors_total' as note;
