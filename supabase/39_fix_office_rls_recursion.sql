-- BlockView — HOTFIX: break the infinite-recursion between the office RLS policies.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- SYMPTOM: every read of `listings` (the public map!) failed with
--   "infinite recursion detected in policy for relation offices"
-- so the map showed no listings for anyone.
--
-- CAUSE: the policies referenced each other's tables in their USING clauses, and
-- each referenced table re-applied ITS policy:
--   listings_read -> (subquery on offices) -> offices_read
--   offices_read  -> (subquery on office_members) -> office_members_read
--   office_members_read -> (subquery on offices) -> offices_read -> ... loop.
--
-- FIX: the same trick is_admin() already uses — move each cross-table check into
-- a SECURITY DEFINER function. A definer function runs with the owner's rights and
-- does NOT re-trigger RLS, so the cycle is cut. Each function returns only a
-- boolean about the CURRENT caller's own relationship, so it leaks nothing.
--
-- SECURITY VERDICT — safe. New helpers are SECURITY DEFINER with search_path
-- pinned to public and no dynamic SQL; they expose only a yes/no about auth.uid().
-- The rewritten policies keep the exact same visibility rules, minus the loop.

-- ============================================ recursion-free helpers ======
create or replace function public.is_office_owner(oid uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.offices where id = oid and owner_id = auth.uid());
$$;

create or replace function public.is_office_member(oid uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.office_members where office_id = oid and user_id = auth.uid());
$$;

create or replace function public.office_is_approved(oid uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.offices where id = oid and status = 'approved');
$$;

-- for leads: does the caller own the office that this listing belongs to?
create or replace function public.owns_office_of_listing(lid uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.listings l join public.offices o on o.id = l.office_id
    where l.id = lid and o.owner_id = auth.uid());
$$;

-- ==================================================== rewritten policies ===
-- offices: approved office is public; owner / member / admin see any status.
drop policy if exists offices_read on public.offices;
create policy offices_read on public.offices for select using (
  status = 'approved'
  or owner_id = auth.uid()
  or public.is_admin()
  or public.is_office_member(id)
);

-- listings: public sees approved; agent sees own; admin all; office owner sees
-- their office's listings.
drop policy if exists listings_read on public.listings;
create policy listings_read on public.listings for select using (
  status = 'approved'
  or agent_id = auth.uid()
  or public.is_admin()
  or public.is_office_owner(listings.office_id)
);

-- leads: agent sees own; admin all; office owner sees leads on office listings.
drop policy if exists leads_read on public.leads;
create policy leads_read on public.leads for select using (
  agent_id = auth.uid()
  or public.is_admin()
  or public.owns_office_of_listing(leads.listing_id)
);

-- office_members: self / admin / office owner see any; active members of an
-- approved office are public (for the office page).
drop policy if exists office_members_read on public.office_members;
create policy office_members_read on public.office_members for select using (
  user_id = auth.uid()
  or public.is_admin()
  or public.is_office_owner(office_members.office_id)
  or (status = 'active' and public.office_is_approved(office_members.office_id))
);

drop policy if exists office_members_delete on public.office_members;
create policy office_members_delete on public.office_members for delete using (
  user_id = auth.uid()
  or public.is_admin()
  or public.is_office_owner(office_members.office_id)
);

-- sanity: this must now succeed instead of raising the recursion error
select count(*) as approved_listings from public.listings where status = 'approved';
