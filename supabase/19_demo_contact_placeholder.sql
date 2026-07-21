-- BlockView — take the owner's real phone number off the public demo listings.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- 13_demo_whatsapp.sql put a real personal number on demo contacts so the 💬
-- button could be tested against a live chat. Those listings are 'approved', so
-- the number is visible to every signed-in visitor on the public map. This
-- replaces it with a placeholder while keeping the WhatsApp flag, so the button
-- still renders for testing but no longer rings a real phone.

update public.listing_contacts
set    phone = '050-0000000'
where  phone in ('052-3125235', '0523125235', '+972523125235', '972523125235');

-- Anything else still carrying it (belt and braces — the column may hold a
-- differently formatted variant).
update public.listing_contacts
set    phone = '050-0000000'
where  regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') like '%523125235';

-- Check: no public contact should expose the real number any more.
select count(*) as remaining_real_number
from   public.listing_contacts
where  regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') like '%523125235';
