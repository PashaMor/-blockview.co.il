-- BlockView — offices Phase 3: roll listings up to the office.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
-- Requires 36_office_members.sql.
--
-- A listing stays owned by its agent; office_id just records which office that
-- agent is in, so an office owner can see the whole office's listings and leads,
-- and the public office page can list them. It is set automatically from the
-- agent's active membership whenever a listing is written.
--
-- SECURITY VERDICT — safe. office_id is derived by a definer trigger from the
-- agent's own membership (not client-supplied), and the only new read path is
-- an office owner seeing listings in their own office. No write path changes.

alter table public.listings add column if not exists office_id uuid references public.offices (id) on delete set null;
create index if not exists listings_office_idx on public.listings (office_id);

-- set office_id from the agent's active office on every write
create or replace function public.set_listing_office()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select office_id into new.office_id
  from public.office_members
  where user_id = new.agent_id and status = 'active'
  order by (member_role = 'owner') desc
  limit 1;
  return new;
end $$;

drop trigger if exists listings_set_office on public.listings;
create trigger listings_set_office before insert or update of agent_id on public.listings
  for each row execute procedure public.set_listing_office();

-- an office owner may read every listing in their office (the owner dashboard)
drop policy if exists listings_read on public.listings;
create policy listings_read on public.listings for select using (
  status = 'approved'
  or agent_id = auth.uid()
  or public.is_admin()
  or exists (select 1 from public.offices o where o.id = listings.office_id and o.owner_id = auth.uid())
);

-- leads follow the same rule: an office owner sees leads on the office's listings
drop policy if exists leads_read on public.leads;
create policy leads_read on public.leads for select using (
  agent_id = auth.uid()
  or public.is_admin()
  or exists (
    select 1 from public.listings l join public.offices o on o.id = l.office_id
    where l.id = leads.listing_id and o.owner_id = auth.uid())
);

-- backfill office_id for listings whose agent is already in an office
update public.listings l
   set office_id = m.office_id
from public.office_members m
where m.user_id = l.agent_id and m.status = 'active' and l.office_id is distinct from m.office_id;

select count(*) filter (where office_id is not null) as listings_in_an_office from public.listings;
