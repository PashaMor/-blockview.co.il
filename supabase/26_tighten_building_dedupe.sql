-- BlockView — stop ensure_building() swallowing the building next door.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
-- Replaces ensure_building() from 17_buildings_from_address.sql and the
-- matching half of preview_building_match() from 25_preview_building_match.sql.
--
-- The old proximity rule merged anything within a ~30 m box. On a street like
-- אלנבי that is several buildings, so a listing entered as "אלנבי 21" was
-- attached to "אלנבי 40" and shown at the wrong address.
--
-- Two changes:
--   1. the box shrinks from ~30 m to ~8 m;
--   2. two addresses with DIFFERENT house numbers never merge, whatever the
--      distance. A house number is the one thing that reliably distinguishes
--      neighbours, and geocoders are routinely off by more than a building
--      width, so distance alone cannot be trusted.
--
-- Existing buildings are untouched; this only affects future matching.

-- ==================================================== house number helper ==
-- First run of digits in the address: "אלנבי 40, תל אביב" -> "40".
-- Returns null when there is no number, in which case we fall back to distance.
create or replace function public.house_no(p_address text)
returns text language sql immutable set search_path = public as $$
  select (regexp_match(coalesce(p_address, ''), '\d+'))[1];
$$;

-- ======================================================== ensure_building ==
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
  v_no  text := public.house_no(p_address);
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

  -- 1) same OSM object — the strongest signal there is
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

  -- 3) the same spot (~8 m box), and never across different house numbers
  select id into v_id from public.buildings
   where abs(lat - p_lat) < 0.00007 and abs(lng - p_lng) < 0.00009
     and (v_no is null                              -- no number to compare
          or public.house_no(address) is null
          or public.house_no(address) = v_no)       -- same number only
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

-- ================================================= preview, kept in step ==
create or replace function public.preview_building_match(
  p_address text,
  p_lat     double precision,
  p_lng     double precision,
  p_osm_id  text default null
) returns table (building_id text, name text, address text, reason text)
language plpgsql security definer set search_path = public as $$
declare
  v public.buildings%rowtype;
  v_reason text;
  v_no text := public.house_no(p_address);
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if p_lat is null or p_lng is null then
    return;
  end if;

  if p_osm_id is not null then
    select * into v from public.buildings where osm_id = p_osm_id;
    if found then v_reason := 'osm'; end if;
  end if;

  if not found and p_address is not null then
    select * into v from public.buildings
     where lower(regexp_replace(btrim(address), '\s+', ' ', 'g'))
         = lower(regexp_replace(btrim(p_address), '\s+', ' ', 'g'))
     limit 1;
    if found then v_reason := 'address'; end if;
  end if;

  if not found then
    select * into v from public.buildings
     where abs(lat - p_lat) < 0.00007 and abs(lng - p_lng) < 0.00009
       and (v_no is null
            or public.house_no(address) is null
            or public.house_no(address) = v_no)
     order by abs(lat - p_lat) + abs(lng - p_lng)
     limit 1;
    if found then v_reason := 'nearby'; end if;
  end if;

  if not found then
    return query select null::text, null::text, null::text, 'new'::text;
    return;
  end if;

  if v.verified
     or exists (select 1 from public.listings l
                where l.building_id = v.id and l.status = 'approved')
     or v.created_by = auth.uid()
     or public.is_admin() then
    return query select v.id, v.name, v.address, v_reason;
  else
    return query select v.id, null::text, null::text, 'existing_hidden'::text;
  end if;
end $$;

revoke all on function public.preview_building_match(text, double precision, double precision, text) from public, anon;
grant execute on function public.preview_building_match(text, double precision, double precision, text) to authenticated;

-- Proof: "אלנבי 21" must no longer resolve to the "אלנבי 40" building.
select public.house_no('אלנבי 21, תל אביב') as typed,
       public.house_no('אלנבי 40, תל אביב') as existing,
       public.house_no('אלנבי 21, תל אביב') = public.house_no('אלנבי 40, תל אביב') as would_merge_now;
