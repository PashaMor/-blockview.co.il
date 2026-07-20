-- BlockView — mark a listing contact's phone as reachable on WhatsApp.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- SECURITY: we only publish a BOOLEAN flag to guests, never the number itself.
-- A wa.me link contains the full phone, so the button is gated behind sign-in
-- exactly like revealing the phone (see supabase/10_listing_contacts.sql).

alter table public.listing_contacts
  add column if not exists whatsapp boolean not null default false;

-- expose the flag (and only the flag) on the public masked view
drop view if exists public.listing_contacts_public;
create view public.listing_contacts_public as
  select c.id,
         c.listing_id,
         c.name,
         c.role,
         c.sort,
         c.whatsapp,                                   -- boolean only
         public.mask_phone(c.phone) as phone_mask,
         public.mask_email(c.email) as email_mask
  from   public.listing_contacts c
  join   public.listings l on l.id = c.listing_id
  where  l.status = 'approved';

grant select on public.listing_contacts_public to anon, authenticated;

select 'whatsapp flag added (number itself stays behind sign-in)' as note;
