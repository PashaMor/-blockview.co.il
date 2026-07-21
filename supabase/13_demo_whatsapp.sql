-- BlockView — flag the demo listing contacts as WhatsApp-reachable so the
-- 💬 button appears while testing. Requires 12_whatsapp.sql.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.

-- Placeholder number: these demo listings are 'approved', so anything here is
-- public on the map. Never put a real personal number in a public demo row —
-- swap it locally for a live WhatsApp test, then put the placeholder back.
update public.listing_contacts c
set    phone = '050-0000000'          -- placeholder, not a real phone
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
