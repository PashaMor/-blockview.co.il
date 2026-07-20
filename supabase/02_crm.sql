-- BlockView — CRM schema (agents, listings, photos, leads)
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.

-- ============================================================ roles ======
alter table public.profiles add column if not exists role text not null default 'user';
do $$ begin
  alter table public.profiles add constraint profiles_role_chk check (role in ('user','agent','admin'));
exception when duplicate_object then null; end $$;

-- SECURITY: stop users from promoting themselves (role) or self-upgrading (plan).
-- Only an admin may change those columns; a null auth.uid() = server/service context.
create or replace function public.protect_profile_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role) or (new.plan is distinct from old.plan) then
    if auth.uid() is not null
       and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') then
      raise exception 'FORBIDDEN_FIELD_CHANGE' using errcode = 'P0001';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect before update on public.profiles
  for each row execute procedure public.protect_profile_fields();

-- role helpers (security definer so policies can read profiles without recursion)
create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'); $$;
create or replace function public.is_agent() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('agent','admin')); $$;

-- ======================================================== buildings ======
create table if not exists public.buildings (
  id         text primary key,
  name       text not null,
  address    text not null,
  city       text not null default 'תל אביב-יפו',
  lng        double precision not null,
  lat        double precision not null,
  w          double precision not null default 0.00028,
  h          double precision not null default 0.00032,
  height     double precision not null default 24,
  created_at timestamptz not null default now()
);

-- ========================================================= listings ======
create table if not exists public.listings (
  id          uuid primary key default gen_random_uuid(),
  building_id text not null references public.buildings (id) on delete cascade,
  agent_id    uuid not null references auth.users (id) on delete cascade,
  deal        text not null check (deal in ('sale','rent')),
  price       numeric not null check (price >= 0),
  rooms       numeric not null check (rooms > 0),
  size        numeric not null check (size > 0),
  floor       int not null default 0,
  title       text not null,
  description text not null default '',
  type        text not null default 'flat' check (type in ('flat','house')),
  furnished   boolean not null default false,
  pets        boolean not null default false,
  parking     boolean not null default false,
  elevator    boolean not null default false,
  age         text not null default 'old' check (age in ('new','old')),
  tour_url    text,
  status      text not null default 'pending' check (status in ('draft','pending','approved','rejected','sold')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists listings_building_idx on public.listings (building_id);
create index if not exists listings_agent_idx    on public.listings (agent_id);
create index if not exists listings_status_idx   on public.listings (status);

-- =================================================== listing photos ======
create table if not exists public.listing_photos (
  id         uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  path       text not null,               -- storage object path
  sort       int  not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists photos_listing_idx on public.listing_photos (listing_id);

-- ============================================================ leads ======
create table if not exists public.leads (
  id         uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  agent_id   uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  phone      text,
  message    text,
  status     text not null default 'new' check (status in ('new','contacted','closed')),
  created_at timestamptz not null default now()
);
create index if not exists leads_agent_idx on public.leads (agent_id);

-- A lead's agent is always derived from the listing (prevents spoofing).
create or replace function public.set_lead_agent()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select l.agent_id into new.agent_id from public.listings l where l.id = new.listing_id;
  if new.agent_id is null then raise exception 'LISTING_NOT_FOUND'; end if;
  return new;
end; $$;
drop trigger if exists leads_set_agent on public.leads;
create trigger leads_set_agent before insert on public.leads
  for each row execute procedure public.set_lead_agent();

-- keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists listings_touch on public.listings;
create trigger listings_touch before update on public.listings
  for each row execute procedure public.touch_updated_at();

-- ====================================================== RLS policies =====
alter table public.buildings      enable row level security;
alter table public.listings       enable row level security;
alter table public.listing_photos enable row level security;
alter table public.leads          enable row level security;

-- buildings: readable by all; agents may add; only admins edit/remove
drop policy if exists buildings_read   on public.buildings;
drop policy if exists buildings_insert on public.buildings;
drop policy if exists buildings_update on public.buildings;
drop policy if exists buildings_delete on public.buildings;
create policy buildings_read   on public.buildings for select using (true);
create policy buildings_insert on public.buildings for insert with check (public.is_agent());
create policy buildings_update on public.buildings for update using (public.is_admin());
create policy buildings_delete on public.buildings for delete using (public.is_admin());

-- listings: public sees only approved; agents fully manage their own; admins all
drop policy if exists listings_read   on public.listings;
drop policy if exists listings_insert on public.listings;
drop policy if exists listings_update on public.listings;
drop policy if exists listings_delete on public.listings;
create policy listings_read on public.listings for select
  using (status = 'approved' or agent_id = auth.uid() or public.is_admin());
create policy listings_insert on public.listings for insert
  with check (agent_id = auth.uid() and public.is_agent());
create policy listings_update on public.listings for update
  using (agent_id = auth.uid() or public.is_admin())
  with check (agent_id = auth.uid() or public.is_admin());
create policy listings_delete on public.listings for delete
  using (agent_id = auth.uid() or public.is_admin());

-- photos follow their listing's visibility / ownership
drop policy if exists photos_read  on public.listing_photos;
drop policy if exists photos_write on public.listing_photos;
create policy photos_read on public.listing_photos for select using (
  exists (select 1 from public.listings l where l.id = listing_id
          and (l.status = 'approved' or l.agent_id = auth.uid() or public.is_admin())));
create policy photos_write on public.listing_photos for all using (
  exists (select 1 from public.listings l where l.id = listing_id
          and (l.agent_id = auth.uid() or public.is_admin()))
) with check (
  exists (select 1 from public.listings l where l.id = listing_id
          and (l.agent_id = auth.uid() or public.is_admin())));

-- leads: anyone may submit an enquiry on an APPROVED listing; only the owning agent reads them
drop policy if exists leads_insert on public.leads;
drop policy if exists leads_read   on public.leads;
drop policy if exists leads_update on public.leads;
create policy leads_insert on public.leads for insert with check (
  exists (select 1 from public.listings l where l.id = listing_id and l.status = 'approved'));
create policy leads_read   on public.leads for select using (agent_id = auth.uid() or public.is_admin());
create policy leads_update on public.leads for update using (agent_id = auth.uid() or public.is_admin());

-- ================================================ storage for photos =====
insert into storage.buckets (id, name, public)
values ('listing-photos', 'listing-photos', true)
on conflict (id) do nothing;

-- public read; each agent may only write inside a folder named after their user id
drop policy if exists "listing photos read"   on storage.objects;
drop policy if exists "listing photos insert" on storage.objects;
drop policy if exists "listing photos update" on storage.objects;
drop policy if exists "listing photos delete" on storage.objects;
create policy "listing photos read" on storage.objects for select
  using (bucket_id = 'listing-photos');
create policy "listing photos insert" on storage.objects for insert
  with check (bucket_id = 'listing-photos' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "listing photos update" on storage.objects for update
  using (bucket_id = 'listing-photos' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "listing photos delete" on storage.objects for delete
  using (bucket_id = 'listing-photos' and auth.uid()::text = (storage.foldername(name))[1]);

-- ============================================ seed the sample buildings ==
insert into public.buildings (id, name, address, lng, lat, w, h, height) values
  ('b1','רוטשילד 22',    'שדרות רוטשילד 22, תל אביב', 34.77145, 32.06405, 0.00028, 0.00034, 32),
  ('b2','רוטשילד 45',    'שדרות רוטשילד 45, תל אביב', 34.77320, 32.06520, 0.00030, 0.00030, 54),
  ('b3','אלנבי 40',      'אלנבי 40, תל אביב',         34.76980, 32.06480, 0.00026, 0.00040, 24),
  ('b4','שינקין 12',     'שינקין 12, תל אביב',        34.77420, 32.06660, 0.00024, 0.00028, 19),
  ('b5','נחלת בנימין 18','נחלת בנימין 18, תל אביב',   34.77060, 32.06310, 0.00026, 0.00032, 27),
  ('b6','הרצל 8',        'הרצל 8, תל אביב',           34.76900, 32.06090, 0.00030, 0.00034, 38),
  ('b7','פלורנטין 5',    'פלורנטין 5, תל אביב',       34.76960, 32.05760, 0.00028, 0.00030, 16),
  ('b8','מזא"ה 33',      'מזא"ה 33, תל אביב',         34.77540, 32.06430, 0.00024, 0.00030, 22)
on conflict (id) do nothing;
