-- BlockView — "what's nearby" for a listing (places around the building + walk time).
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- Everything here is PUBLIC GEODATA from OpenStreetMap, precomputed once per
-- building by scripts/nearby-import.mjs. Nothing about a viewer is stored, and
-- the app never calls a third-party service at runtime — the map already taught
-- us that Overpass is too flaky to sit in the request path.

-- ============================================================== places ====
create table if not exists public.places (
  id         text primary key,             -- OSM type+id, e.g. "node/240109189"
  category   text not null check (category in ('education','transit','errands','leisure')),
  kind       text not null,                -- kindergarten, supermarket, bus_stop, park...
  names      jsonb not null default '{}',  -- {"he":"...","en":"...","ar":"...","default":"..."}
  lng        double precision not null,
  lat        double precision not null,
  updated_at timestamptz not null default now()
);
create index if not exists places_cat_idx on public.places (category);

-- ==================================================== building_places ====
-- The precomputed answer for one building: nearest N per category, with the
-- distance and the estimated walking time already worked out.
create table if not exists public.building_places (
  building_id  text not null references public.buildings (id) on delete cascade,
  place_id     text not null references public.places (id)    on delete cascade,
  category     text not null check (category in ('education','transit','errands','leisure')),
  meters       int  not null check (meters >= 0),
  walk_minutes int  not null check (walk_minutes >= 1),
  rank         int  not null check (rank >= 1),   -- 1 = closest in its category
  primary key (building_id, place_id)
);
create index if not exists building_places_lookup_idx
  on public.building_places (building_id, category, rank);

-- ======================================================== RLS policies ====
-- Public geodata: readable by everyone (including signed-out visitors and the
-- app), writable only by an admin. The importer runs outside the browser with
-- the service key, which bypasses RLS by design.
alter table public.places         enable row level security;
alter table public.building_places enable row level security;

drop policy if exists places_read          on public.places;
drop policy if exists places_write         on public.places;
drop policy if exists building_places_read  on public.building_places;
drop policy if exists building_places_write on public.building_places;

create policy places_read  on public.places for select using (true);
create policy places_write on public.places for all
  using (public.is_admin()) with check (public.is_admin());

create policy building_places_read  on public.building_places for select using (true);
create policy building_places_write on public.building_places for all
  using (public.is_admin()) with check (public.is_admin());

-- ===================================================== coverage report ====
-- Which buildings still need `node scripts/nearby-import.mjs --missing`:
select b.id, b.name, count(bp.place_id) as places
from   public.buildings b
left   join public.building_places bp on bp.building_id = b.id
group  by b.id, b.name
order  by places asc, b.name;
