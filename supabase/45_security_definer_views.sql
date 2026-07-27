-- BlockView — clear the Supabase advisor's "Security Definer View" (CRITICAL) on
-- public.buildings_visible and public.listing_contacts_public.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- Both views are safe today, but a SECURITY DEFINER view runs with the owner's
-- rights and bypasses RLS, which the advisor flags. This makes both views
-- security_invoker (they defer to the caller's RLS) WITHOUT exposing anything
-- that was hidden before.
--
-- SECURITY VERDICT — safe to run.
--   * buildings_visible: its filter is already mirrored by the base-table RLS
--     (migration 18), so as invoker it returns the same rows to anon.
--   * listing_contacts_public: guests still see ONLY masked phone/email. The raw
--     phone/email columns are REVOKED from anon at the column level, so no path —
--     the view OR a direct table request — can return them to an anonymous user.
--   * The only new SECURITY DEFINER object is listing_is_approved(uuid): a small
--     STABLE helper with search_path pinned; it leaks nothing (a boolean about a
--     public 'approved' status) and exists so the anon row policy doesn't
--     cross-join an RLS table inline.

-- ============================ buildings_visible ============================
create or replace view public.buildings_visible
  with (security_invoker = true) as
  select b.*
  from   public.buildings b
  where  b.verified
     or  exists (select 1 from public.listings l
                 where l.building_id = b.id and l.status = 'approved');
grant select on public.buildings_visible to anon, authenticated;

-- ======================= listing_contacts_public ==========================
-- (a) store the masked values as generated columns the caller may read
--     (mask_phone / mask_email are immutable — see migration 10)
alter table public.listing_contacts
  add column if not exists phone_mask text generated always as (public.mask_phone(phone)) stored,
  add column if not exists email_mask text generated always as (public.mask_email(email)) stored;

-- helper: is this listing approved? (definer so the policy below stays simple)
create or replace function public.listing_is_approved(lid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.listings l where l.id = lid and l.status = 'approved');
$$;
grant execute on function public.listing_is_approved(uuid) to anon, authenticated;

-- (b) anon may read contact rows of approved listings...
drop policy if exists listing_contacts_anon_masked on public.listing_contacts;
create policy listing_contacts_anon_masked on public.listing_contacts
  for select to anon
  using (public.listing_is_approved(listing_id));

-- (c) ...but only the SAFE columns. Raw phone/email are never granted to anon.
revoke select on public.listing_contacts from anon;
grant  select (id, listing_id, name, role, sort, whatsapp, phone_mask, email_mask)
       on public.listing_contacts to anon;
grant  select on public.listing_contacts to authenticated;  -- signed-in: full row, RLS still gates which rows

-- the view, now as invoker, selects only the safe/masked columns
drop view if exists public.listing_contacts_public;
create view public.listing_contacts_public
  with (security_invoker = true) as
  select c.id, c.listing_id, c.name, c.role, c.sort, c.whatsapp,
         c.phone_mask, c.email_mask
  from   public.listing_contacts c
  where  public.listing_is_approved(c.listing_id);
grant select on public.listing_contacts_public to anon, authenticated;

select 'both views are now security_invoker; anon still sees masked contacts only' as note;
