-- BlockView — harden the offices RLS: no policy cross-references another RLS
-- table directly; every cross-table check goes through a SECURITY DEFINER helper.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
-- Supersedes the inline subqueries added in 34/36/37.
--
-- Why: a policy on A that sub-selects RLS-protected B invokes B's policy, and if
-- B's policy sub-selects A you get mutual recursion — fragile, slow, and prone to
-- "infinite recursion detected in policy". The project already solves this with
-- is_admin()/is_agent() (definer functions read the table without triggering its
-- RLS). These helpers do the same for offices, so offices_read, office_members_read,
-- listings_read and leads_read no longer touch each other's tables directly.
--
-- SECURITY VERDICT — safe, and an improvement. Each helper is SECURITY DEFINER
-- with search_path pinned and returns only a boolean (no row data leaks). Access
-- granted matches exactly what the inline subqueries expressed before.

create or replace function public.owns_office(p_office uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.offices where id = p_office and owner_id = auth.uid());
$$;
create or replace function public.is_office_member(p_office uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.office_members
                 where office_id = p_office and user_id = auth.uid() and status = 'active');
$$;
create or replace function public.office_is_approved(p_office uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.offices where id = p_office and status = 'approved');
$$;
create or replace function public.owns_listing_office(p_listing uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.listings l
                 join public.offices o on o.id = l.office_id
                 where l.id = p_listing and o.owner_id = auth.uid());
$$;

grant execute on function public.owns_office(uuid),
                         public.is_office_member(uuid),
                         public.office_is_approved(uuid),
                         public.owns_listing_office(uuid)
  to anon, authenticated;

-- ---- offices: approved is public; owner / member / admin see any status ----
drop policy if exists offices_read on public.offices;
create policy offices_read on public.offices for select using (
  status = 'approved' or owner_id = auth.uid() or public.is_admin() or public.is_office_member(id)
);

-- ---- office_members: self, admin, the office owner, or an approved office's
--      active roster (public, for the office page) ----
drop policy if exists office_members_read on public.office_members;
create policy office_members_read on public.office_members for select using (
  user_id = auth.uid()
  or public.is_admin()
  or public.owns_office(office_id)
  or (status = 'active' and public.office_is_approved(office_id))
);

-- ---- listings: approved, own, admin, or the owner of the listing's office ----
drop policy if exists listings_read on public.listings;
create policy listings_read on public.listings for select using (
  status = 'approved' or agent_id = auth.uid() or public.is_admin() or public.owns_office(office_id)
);

-- ---- leads: the owning agent, admin, or the owner of the listing's office ----
drop policy if exists leads_read on public.leads;
create policy leads_read on public.leads for select using (
  agent_id = auth.uid() or public.is_admin() or public.owns_listing_office(listing_id)
);

select 'offices RLS now goes through definer helpers — no cross-table recursion' as note;
