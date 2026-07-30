-- BlockView — per-listing button-click analytics (WhatsApp, phone, save, share, message).
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
-- Requires 16_analytics.sql.
--
-- Until now a tap on WhatsApp or phone was recorded as a generic 'contact'. This
-- splits them into their own events and returns each count per listing, so the
-- CRM analytics can show WhatsApp / phone / saved / shared / message separately.
--
-- SECURITY VERDICT — safe. Widens one CHECK constraint (more allowed values) and
-- rewrites agent_listing_stats() (still SECURITY DEFINER, search_path pinned,
-- and still returns only the caller's own listings — an agent can't read others').

-- ============================================ allow the new event names ====
alter table public.listing_views drop constraint if exists listing_views_event_check;
alter table public.listing_views add constraint listing_views_event_check
  check (event in ('impression','detail','contact','lead','share','favorite','whatsapp','phone'));

-- ==================================== stats, now with the click breakdown ==
create or replace function public.agent_listing_stats(
  from_date date,
  to_date   date,
  surface_filter text default null,      -- 'web' | 'app' | null = both
  listing   uuid default null            -- one listing, or null = all of mine
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  admin boolean := public.is_admin();
  result jsonb;
begin
  if me is null then raise exception 'NOT_SIGNED_IN' using errcode = 'P0001'; end if;
  if not admin and not public.is_agent() then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  if from_date is null or to_date is null or to_date < from_date then
    raise exception 'BAD_RANGE' using errcode = 'P0001';
  end if;

  with scope as (
    select l.id, l.title, l.deal, l.status
    from   public.listings l
    where  (admin or l.agent_id = me)
      and  (listing is null or l.id = listing)
  ),
  ev as (
    select v.*
    from   public.listing_views v
    join   scope s on s.id = v.listing_id
    where  v.day between from_date and to_date
      and  (surface_filter is null or v.surface = surface_filter)
  )
  select jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        'impressions',    count(*) filter (where event = 'impression'),
        'views',          count(*) filter (where event = 'detail'),
        'unique_viewers', count(distinct viewer_key) filter (where event = 'detail'),
        'contacts',       count(*) filter (where event in ('contact','lead','whatsapp','phone')),
        'shares',         count(*) filter (where event = 'share'),
        'favorites',      count(*) filter (where event = 'favorite'),
        'whatsapp',       count(*) filter (where event = 'whatsapp'),
        'phone',          count(*) filter (where event = 'phone'),
        'messages',       count(*) filter (where event = 'lead'),
        'web',            count(*) filter (where event = 'detail' and surface = 'web'),
        'app',            count(*) filter (where event = 'detail' and surface = 'app')
      ) from ev
    ),
    'daily', coalesce((
      select jsonb_agg(d order by d->>'day')
      from (
        select jsonb_build_object(
          'day',   day,
          'views', count(*) filter (where event = 'detail'),
          'web',   count(*) filter (where event = 'detail' and surface = 'web'),
          'app',   count(*) filter (where event = 'detail' and surface = 'app')
        ) as d
        from ev group by day
      ) x
    ), '[]'::jsonb),
    'listings', coalesce((
      select jsonb_agg(r order by (r->>'views')::int desc)
      from (
        select jsonb_build_object(
          'id',             s.id,
          'title',          s.title,
          'status',         s.status,
          'views',          count(e.id) filter (where e.event = 'detail'),
          'unique_viewers', count(distinct e.viewer_key) filter (where e.event = 'detail'),
          'impressions',    count(e.id) filter (where e.event = 'impression'),
          'contacts',       count(e.id) filter (where e.event in ('contact','lead','whatsapp','phone')),
          'whatsapp',       count(e.id) filter (where e.event = 'whatsapp'),
          'phone',          count(e.id) filter (where e.event = 'phone'),
          'saves',          count(e.id) filter (where e.event = 'favorite'),
          'shares',         count(e.id) filter (where e.event = 'share'),
          'messages',       count(e.id) filter (where e.event = 'lead'),
          'web',            count(e.id) filter (where e.event = 'detail' and e.surface = 'web'),
          'app',            count(e.id) filter (where e.event = 'detail' and e.surface = 'app')
        ) as r
        from scope s left join ev e on e.listing_id = s.id
        group by s.id, s.title, s.status
      ) y
    ), '[]'::jsonb)
  ) into result;

  return result;
end; $$;

revoke all on function public.agent_listing_stats(date, date, text, uuid) from public, anon;
grant execute on function public.agent_listing_stats(date, date, text, uuid) to authenticated;

select 'analytics: whatsapp/phone split out, per-listing click counts added' as note;
