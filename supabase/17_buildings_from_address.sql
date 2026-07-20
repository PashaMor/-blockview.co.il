-- BlockView — create a building from an address, automatically.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- Until now a listing could only attach to one of the hand-seeded buildings, and
-- only an admin could add one. This lets the publish flow resolve an address (via
-- OSM, client-side) and get a building back — WITHOUT opening the buildings table
-- to the public:
--   * the client never inserts a building; it calls ensure_building(), which is
--     SECURITY DEFINER and does dedupe-or-create itself;
--   * a building created this way is NOT verified, and stays off the public map
--     until one of its listings is approved (or an admin verifies it);
--   * creation is rate-limited per user.

-- ================================================== new building columns ==
alter table public.buildings add column if not exists footprint  jsonb;   -- GeoJSON polygon (real outline)
alter table public.buildings add column if not exists osm_id     text;    -- e.g. way/123456 — natural dedupe key
alter table public.buildings add column if not exists verified   boolean not null default true;  -- existing rows are trusted
alter table public.buildings add column if not exists created_by uuid references auth.users (id) on delete set null;
alter table public.buildings add column if not exists source     text not null default 'manual';

create unique index if not exists buildings_osm_id_uidx on public.buildings (osm_id) where osm_id is not null;
create index if not exists buildings_latlng_idx on public.buildings (lat, lng);

-- =================================================== dedupe-or-create =====
-- Returns the id of an existing building at that spot, or creates a new one.
-- Matching order: same OSM id -> same address -> within ~30 m.
create or replace function public.ensure_building(
  p_name      text,
  p_address   text,
  p_city      text,
  p_lat       double precision,
  p_lng       double precision,
  p_osm_id    text default null,
  p_footprint jsonb default null,
  p_height    double precision default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_id  text;
  v_cnt int;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if p_lat is null or p_lng is null
     or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'BAD_COORDS' using errcode = 'P0001';
  end if;
  if length(btrim(coalesce(p_address, ''))) < 4 then
    raise exception 'BAD_ADDRESS' using errcode = 'P0001';
  end if;

  -- 1) same OSM object
  if p_osm_id is not null then
    select id into v_id from public.buildings where osm_id = p_osm_id;
    if v_id is not null then return v_id; end if;
  end if;

  -- 2) same address (normalised)
  select id into v_id from public.buildings
   where lower(regexp_replace(btrim(address), '\s+', ' ', 'g'))
       = lower(regexp_replace(btrim(p_address), '\s+', ' ', 'g'))
   limit 1;
  if v_id is not null then return v_id; end if;

  -- 3) practically the same spot (~30 m box) — neighbours must not duplicate it
  select id into v_id from public.buildings
   where abs(lat - p_lat) < 0.00027 and abs(lng - p_lng) < 0.00032
   order by abs(lat - p_lat) + abs(lng - p_lng)
   limit 1;
  if v_id is not null then return v_id; end if;

  -- rate limit: a person has no reason to add many buildings per hour
  select count(*) into v_cnt from public.buildings
   where created_by = auth.uid() and created_at > now() - interval '1 hour';
  if v_cnt >= 10 then
    raise exception 'TOO_MANY_BUILDINGS' using errcode = 'P0001';
  end if;

  v_id := 'bv-' || replace(gen_random_uuid()::text, '-', '');
  insert into public.buildings (id, name, address, city, lng, lat, height,
                                footprint, osm_id, verified, created_by, source)
  values (v_id,
          nullif(btrim(coalesce(p_name, '')), ''),
          btrim(p_address),
          coalesce(nullif(btrim(coalesce(p_city, '')), ''), 'תל אביב-יפו'),
          p_lng, p_lat,
          coalesce(p_height, 24),
          p_footprint, p_osm_id,
          false,                      -- unverified until a listing is approved
          auth.uid(), 'osm');
  return v_id;
exception when not_null_violation then
  -- name is NOT NULL in the original schema; fall back to the address
  insert into public.buildings (id, name, address, city, lng, lat, height,
                                footprint, osm_id, verified, created_by, source)
  values (v_id, btrim(p_address), btrim(p_address),
          coalesce(nullif(btrim(coalesce(p_city, '')), ''), 'תל אביב-יפו'),
          p_lng, p_lat, coalesce(p_height, 24), p_footprint, p_osm_id,
          false, auth.uid(), 'osm');
  return v_id;
end; $$;

revoke all on function public.ensure_building(text, text, text, double precision, double precision, text, jsonb, double precision) from public, anon;
grant execute on function public.ensure_building(text, text, text, double precision, double precision, text, jsonb, double precision) to authenticated;

-- ============================================ what the public map shows ===
-- A building appears once it is verified, or once it actually has an approved
-- listing. So a building invented by a spammer never reaches the map.
create or replace view public.buildings_visible as
  select b.*
  from   public.buildings b
  where  b.verified
     or  exists (select 1 from public.listings l
                 where l.building_id = b.id and l.status = 'approved');

grant select on public.buildings_visible to anon, authenticated;

-- keep an admin able to flip `verified` (buildings_update is already admin-only)
select 'ensure_building() ready; unverified buildings stay off the map' as note;
