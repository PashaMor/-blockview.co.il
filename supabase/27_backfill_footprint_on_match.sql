-- BlockView — when we match an existing building, fill in an outline it is missing.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
-- Replaces ensure_building() from 26_tighten_building_dedupe.sql.
--
-- ensure_building() returns an existing building the moment it matches one, and
-- ignores everything else it was handed. So a building created when the outline
-- lookup was failing keeps its null footprint for ever: the next publisher at
-- that address finds the real outline, we match their address to the existing
-- record, and we throw the outline away. The building stays a generic box
-- sitting off to the side of the real one.
--
-- Matching is unchanged. The only difference: on a match we fill in footprint,
-- height and osm_id IF the stored row has none. We never overwrite an outline
-- that is already there — an admin-verified building stays as the admin left it.

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

  -- 1) same OSM object
  if p_osm_id is not null then
    select id into v_id from public.buildings where osm_id = p_osm_id;
  end if;

  -- 2) same address (normalised)
  if v_id is null then
    select id into v_id from public.buildings
     where lower(regexp_replace(btrim(address), '\s+', ' ', 'g'))
         = lower(regexp_replace(btrim(p_address), '\s+', ' ', 'g'))
     limit 1;
  end if;

  -- 3) the same spot (~8 m box), never across different house numbers
  if v_id is null then
    select id into v_id from public.buildings
     where abs(lat - p_lat) < 0.00007 and abs(lng - p_lng) < 0.00009
       and (v_no is null
            or public.house_no(address) is null
            or public.house_no(address) = v_no)
     order by abs(lat - p_lat) + abs(lng - p_lng)
     limit 1;
  end if;

  -- matched: top up what is missing, then hand the building back
  if v_id is not null then
    update public.buildings b
       set footprint = coalesce(b.footprint, p_footprint),
           osm_id    = coalesce(b.osm_id, p_osm_id),
           height    = case when b.footprint is null and p_footprint is not null
                            then coalesce(p_height, b.height) else b.height end,
           -- only re-centre a building we are giving an outline to for the
           -- first time; a placed building keeps the position it has
           lat       = case when b.footprint is null and p_footprint is not null
                            then p_lat else b.lat end,
           lng       = case when b.footprint is null and p_footprint is not null
                            then p_lng else b.lng end
     where b.id = v_id
       and (b.footprint is null or b.osm_id is null);
    return v_id;
  end if;

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

select count(*) filter (where footprint is null) as still_without_outline,
       count(*) filter (where footprint is not null) as with_outline
from   public.buildings;
