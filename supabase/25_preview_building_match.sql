-- BlockView — tell the owner WHICH building their listing will attach to,
-- before they submit. Read-only; creates nothing.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- ensure_building() silently dedupes: same OSM id -> same address -> within
-- ~30 m. On a dense street that means an owner can type "אלנבי 21", get
-- attached to "אלנבי 40" next door, and never be told. This function runs the
-- SAME matching rules without writing anything, so the publish form can say
-- "this will be added to אלנבי 40" while the owner can still change their mind.
--
-- Keep the matching here in step with ensure_building() in
-- 17_buildings_from_address.sql — if one changes, change both.

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
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if p_lat is null or p_lng is null then
    return;                                   -- nothing to preview yet
  end if;

  -- 1) same OSM object
  if p_osm_id is not null then
    select * into v from public.buildings where osm_id = p_osm_id;
    if found then v_reason := 'osm'; end if;
  end if;

  -- 2) same address (normalised)
  if not found and p_address is not null then
    select * into v from public.buildings
     where lower(regexp_replace(btrim(address), '\s+', ' ', 'g'))
         = lower(regexp_replace(btrim(p_address), '\s+', ' ', 'g'))
     limit 1;
    if found then v_reason := 'address'; end if;
  end if;

  -- 3) practically the same spot (~30 m box)
  if not found then
    select * into v from public.buildings
     where abs(lat - p_lat) < 0.00027 and abs(lng - p_lng) < 0.00032
     limit 1;
    if found then v_reason := 'nearby'; end if;
  end if;

  if not found then
    return query select null::text, null::text, null::text, 'new'::text;
    return;
  end if;

  -- Only reveal the details of a building this caller is allowed to see —
  -- the same rule as the buildings_read policy. A pending building belonging
  -- to someone else must not leak its address through this preview.
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

select 'preview_building_match ready — the publish form can now warn before merging' as note;
