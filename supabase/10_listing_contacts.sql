-- BlockView — contact people on a listing (name / phone / email), one or many.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- Rule: a visitor who is NOT signed in sees only a MASKED phone/email.
-- A signed-in user sees the full details. That is enforced HERE, not in the UI:
-- anonymous requests cannot read the contacts table at all; they may only read a
-- view that exposes masked values, and only for already-approved listings.

-- ================================================== the real details ======
create table if not exists public.listing_contacts (
  id         uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  name       text not null check (length(btrim(name)) between 2 and 80),
  phone      text not null check (length(btrim(phone)) between 6 and 20),
  email      text          check (email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  role       text,                                    -- e.g. "בעל הנכס", "שותף", "מתווך"
  sort       int  not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists listing_contacts_listing_idx on public.listing_contacts (listing_id);

-- a listing may not carry an unbounded number of contacts
create or replace function public.limit_listing_contacts()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(*) into n from public.listing_contacts where listing_id = new.listing_id;
  if n >= 5 then raise exception 'TOO_MANY_CONTACTS' using errcode = 'P0001'; end if;
  return new;
end; $$;
drop trigger if exists listing_contacts_limit on public.listing_contacts;
create trigger listing_contacts_limit before insert on public.listing_contacts
  for each row execute procedure public.limit_listing_contacts();

-- ========================================================== masking =======
-- keeps the first 3 digits and the last 2:  050-123-4567 -> 050•••••67
create or replace function public.mask_phone(p text)
returns text language sql immutable set search_path = public as $$
  select case when p is null then null else (
    with d as (select regexp_replace(p, '\D', '', 'g') as x)
    select case when length(x) < 6 then repeat('•', greatest(length(x), 4))
                else left(x, 3) || repeat('•', length(x) - 5) || right(x, 2) end
    from d) end; $$;

-- keeps the first 2 characters and the domain:  pasha@gmail.com -> pa•••@gmail.com
create or replace function public.mask_email(e text)
returns text language sql immutable set search_path = public as $$
  select case when e is null or position('@' in e) = 0 then null
              else left(split_part(e, '@', 1), 2) || '•••@' || split_part(e, '@', 2) end; $$;

-- =============================================================== RLS ======
alter table public.listing_contacts enable row level security;

-- READ (full details): signed-in users on approved listings, plus the poster and admins.
drop policy if exists listing_contacts_read on public.listing_contacts;
create policy listing_contacts_read on public.listing_contacts for select
  using (
    exists (
      select 1 from public.listings l
      where l.id = listing_id
        and (
          (auth.uid() is not null and l.status = 'approved')  -- any signed-in user
          or l.agent_id = auth.uid()                          -- the poster
          or public.is_admin()                                -- moderation
        )
    )
  );

-- WRITE: only the listing's own poster (or an admin).
drop policy if exists listing_contacts_write on public.listing_contacts;
create policy listing_contacts_write on public.listing_contacts for all
  using (
    exists (select 1 from public.listings l
            where l.id = listing_id and (l.agent_id = auth.uid() or public.is_admin()))
  ) with check (
    exists (select 1 from public.listings l
            where l.id = listing_id and (l.agent_id = auth.uid() or public.is_admin()))
  );

-- ================================================ the public (masked) view =
-- This view intentionally runs with the owner's rights, i.e. it bypasses the RLS
-- above — that is the whole point, and it is why it (a) never selects `phone` or
-- `email` in the clear and (b) hard-filters to approved listings only.
drop view if exists public.listing_contacts_public;
create view public.listing_contacts_public as
  select c.id,
         c.listing_id,
         c.name,
         c.role,
         c.sort,
         public.mask_phone(c.phone) as phone_mask,
         public.mask_email(c.email) as email_mask
  from   public.listing_contacts c
  join   public.listings l on l.id = c.listing_id
  where  l.status = 'approved';

grant select on public.listing_contacts_public to anon, authenticated;

select 'listing contacts ready: masked view for guests, full table for signed-in users' as note;
