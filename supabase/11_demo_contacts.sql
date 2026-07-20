-- BlockView — give the 20 demo listings a contact person (or two).
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
-- Requires 10_listing_contacts.sql.
--
-- Only touches listings that belong to the demo account below and have no
-- contacts yet, so it can never overwrite a real owner's details.

-- primary contact: one per demo listing
insert into public.listing_contacts (listing_id, name, phone, email, role, sort)
select l.id,
       'ענבל לוי',
       '050-1234567',
       u.email,
       'בעל הנכס',
       0
from   public.listings l
join   auth.users u on u.id = l.agent_id
where  u.email = 'pasham1991@gmail.com'
  and  not exists (select 1 from public.listing_contacts c where c.listing_id = l.id);

-- second contact on the sale listings, so the multi-contact UI has something to show
insert into public.listing_contacts (listing_id, name, phone, email, role, sort)
select l.id,
       'דניאל כהן',
       '052-7654321',
       'daniel.demo@blockview.co.il',
       'איש קשר נוסף',
       1
from   public.listings l
join   auth.users u on u.id = l.agent_id
where  u.email = 'pasham1991@gmail.com'
  and  l.deal = 'sale'
  and  not exists (select 1 from public.listing_contacts c
                   where c.listing_id = l.id and c.sort = 1);

-- what the public (not signed in) would see vs what a signed-in user sees
select l.title,
       c.name,
       c.phone                     as full_phone,
       public.mask_phone(c.phone)  as guest_sees,
       c.email                     as full_email,
       public.mask_email(c.email)  as guest_sees_email
from   public.listing_contacts c
join   public.listings l on l.id = c.listing_id
order  by l.created_at desc, c.sort
limit  10;
