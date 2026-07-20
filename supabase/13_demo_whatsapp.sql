-- BlockView — flag the demo listing contacts as WhatsApp-reachable so the
-- 💬 button appears while testing. Requires 12_whatsapp.sql.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.

-- Uses the owner's real WhatsApp number so the button opens a real chat.
update public.listing_contacts c
set    phone = '052-3125235'          -- the owner's real WhatsApp number
where  c.name = 'ענבל לוי'
  and  exists (select 1 from public.listings l join auth.users u on u.id = l.agent_id
               where l.id = c.listing_id and u.email = 'pasham1991@gmail.com');

-- mark the primary demo contact as reachable on WhatsApp
update public.listing_contacts c
set    whatsapp = true
where  c.sort = 0
  and  exists (select 1 from public.listings l join auth.users u on u.id = l.agent_id
               where l.id = c.listing_id and u.email = 'pasham1991@gmail.com');

select count(*) as whatsapp_contacts from public.listing_contacts where whatsapp;
