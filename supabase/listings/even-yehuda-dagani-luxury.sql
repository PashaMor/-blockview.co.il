-- BlockView — one-off: PENDING listing from an agent's Facebook post.
-- Source: דגני יצחק (תיווך נדל״ן, אבן יהודה) — בית יוקרה עם בריכה.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- DATA only: one building, one pending listing under the admin account, one
-- contact. No DDL, no SECURITY DEFINER, no RLS/privilege change.
--
-- COMPLETE IN ADMIN before approving:
--   * מחיר — not in the post (inserted 0)
--   * חדרים — not in the post (inserted 6 as a guess for a 330 מ״ר house)
--   * location — only "אבן יהודה" given, no street; placed near the town centre
--     (offset from the other Even Yehuda listing) so set the real spot

with b as (
  insert into public.buildings (id, name, address, city, lng, lat, verified, source)
  values ('bv-ey-dagani-luxury', 'בית יוקרה, אבן יהודה', 'אבן יהודה', 'אבן יהודה',
          34.8880, 32.2708, false, 'manual')
  on conflict (id) do update set city = excluded.city
  returning id
),
l as (
  insert into public.listings
    (building_id, agent_id, deal, price, rooms, size, floor,
     title, description, type, category, age, parking, status, poster_type)
  select b.id, u.id, 'sale', 0, 6, 330, 0,
         'בית יוקרה עם בריכה באבן יהודה',
         $desc$בית נדיר ויוקרתי באבן יהודה, במיקום גבוה ופנטסטי.
על מגרש של 920 מ״ר, שטח בנוי 330 מ״ר.
כולל בריכת שחייה ופינוקים נוספים.$desc$,
         'house', 'residential', 'new', true, 'pending', 'agent'
  from b
  cross join (select id from auth.users where email = 'pasham1991@gmail.com') u
  where not exists (
    select 1 from public.listings x
    where x.building_id = b.id and x.title = 'בית יוקרה עם בריכה באבן יהודה'
  )
  returning id
)
insert into public.listing_contacts (listing_id, name, phone, email, role, whatsapp, sort)
select l.id, 'דגני יצחק', '050-5818828', null, 'מתווך נדל״ן', true, 0
from l;

select 'created (or already existed) — set price, rooms & location in admin, then approve' as note;
