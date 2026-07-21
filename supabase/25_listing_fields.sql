-- BlockView — more on a listing: floor out of N, residential vs commercial,
-- and an agent's own website link.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.

-- ============================================== floor X out of Y =========
alter table public.listings add column if not exists floors_total int;
do $$ begin
  alter table public.listings add constraint listings_floors_total_chk
    check (floors_total is null or (floors_total >= 1 and floors_total <= 200));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.listings add constraint listings_floor_within_building_chk
    check (floors_total is null or floor is null or floor <= floors_total);
exception when duplicate_object then null; end $$;

-- ==================================== residential vs commercial ==========
alter table public.listings add column if not exists category text not null default 'residential';
do $$ begin
  alter table public.listings add constraint listings_category_chk
    check (category in ('residential','commercial'));
exception when duplicate_object then null; end $$;

-- the property type list grows with the commercial kinds. The old constraint
-- only allowed flat/house, so it has to be replaced rather than added to.
alter table public.listings drop constraint if exists listings_type_check;
alter table public.listings drop constraint if exists listings_type_chk;
do $$ begin
  alter table public.listings add constraint listings_type_chk
    check (type in ('flat','house','penthouse','studio',      -- residential
                    'office','shop','warehouse','other'));     -- commercial
exception when duplicate_object then null; end $$;

-- a commercial listing cannot be a flat, and vice versa
do $$ begin
  alter table public.listings add constraint listings_category_type_chk check (
    (category = 'residential' and type in ('flat','house','penthouse','studio'))
    or (category = 'commercial' and type in ('office','shop','warehouse','other'))
  ) not valid;    -- NOT VALID: existing rows keep working, new writes must match
exception when duplicate_object then null; end $$;

create index if not exists listings_category_idx on public.listings (category);

-- =========================================== the agent's own website =====
-- Per listing, so an agent can point at the property page on their own site.
-- Only http(s) — a javascript: or data: URL here would be an XSS vector when
-- rendered as a link.
alter table public.listings add column if not exists website_url text;
do $$ begin
  alter table public.listings add constraint listings_website_url_chk
    check (website_url is null or website_url ~* '^https?://[^\s<>"]+$');
exception when duplicate_object then null; end $$;

-- The same link on the agent's profile, so it can be shown on all their
-- listings without retyping. Carried over on approval (below).
alter table public.agent_profiles     add column if not exists website text;
alter table public.agent_applications add column if not exists website text;
do $$ begin
  alter table public.agent_profiles add constraint agent_profiles_website_chk
    check (website is null or website ~* '^https?://[^\s<>"]+$');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.agent_applications add constraint agent_apps_website_chk
    check (website is null or website ~* '^https?://[^\s<>"]+$');
exception when duplicate_object then null; end $$;

-- approval copies the website across with the rest of the branding
create or replace function public.review_agent_application(
  target uuid, decision text, note text default ''
) returns void
language plpgsql security definer set search_path = public as $$
declare
  app public.agent_applications%rowtype;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if decision not in ('approved','rejected') then
    raise exception 'BAD_DECISION' using errcode = 'P0001';
  end if;

  update public.agent_applications a
     set status     = decision,
         admin_note = coalesce(review_agent_application.note, ''),
         decided_by = auth.uid(),
         decided_at = now()
   where a.user_id = target
  returning a.* into app;

  if not found then
    raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0001';
  end if;

  if decision = 'approved' then
    update public.profiles set role = 'agent' where id = target and role = 'user';

    insert into public.agent_profiles (user_id, first_name, last_name, agency, license_no, logo_path, phone, website)
    values (target, app.first_name, app.last_name, app.agency, app.license_no, app.logo_path, app.phone, app.website)
    on conflict (user_id) do update
      set first_name = excluded.first_name,
          last_name  = excluded.last_name,
          agency     = excluded.agency,
          license_no = excluded.license_no,
          logo_path  = coalesce(excluded.logo_path, public.agent_profiles.logo_path),
          phone      = excluded.phone,
          website    = coalesce(excluded.website, public.agent_profiles.website);
  end if;
end; $$;

revoke all on function public.review_agent_application(uuid, text, text) from public, anon;
grant execute on function public.review_agent_application(uuid, text, text) to authenticated;

select count(*) filter (where category = 'commercial') as commercial,
       count(*) filter (where category = 'residential') as residential,
       count(*) filter (where floors_total is not null) as with_floors_total
from   public.listings;
