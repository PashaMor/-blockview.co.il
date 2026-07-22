-- BlockView — one-off: create a PENDING listing from an agent's Facebook post.
-- Source: ניצן גלנטר (CityZen Village) — בית בודד, אבן יהודה.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- This is DATA, not a schema migration: it inserts one building, one pending
-- listing under the admin account, and the agent's contact. Nothing about
-- security, RLS or privileges changes. No SECURITY DEFINER, no DDL.
--
-- TO COMPLETE IN THE ADMIN DASHBOARD before approving:
--   * מחיר — not in the post (inserted as 0)
--   * exact location — "הרחבה 212" does not geocode; placed at the town centre,
--     so drag/verify the building or set the real street
--   * confirm rooms (5 = 4 bedrooms + salon) and building age (guessed: new)

with b as (
  insert into public.buildings (id, name, address, city, lng, lat, verified, source)
  values ('bv-ey-harchava-212', 'הרחבה 212', 'הרחבה 212, אבן יהודה', 'אבן יהודה',
          34.8890, 32.2716, false, 'manual')
  on conflict (id) do update set city = excluded.city   -- lets RETURNING work on a re-run
  returning id
),
l as (
  insert into public.listings
    (building_id, agent_id, deal, price, rooms, size, floor, floors_total,
     title, description, type, category, age, status, poster_type)
  select b.id, u.id, 'sale', 0, 5, 360, 0, 3,
         'בית בודד באבן יהודה',
         $desc$בית בודד מרווח בהרחבה השקטה של אבן יהודה, ברחוב חד-סטרי קרוב להכל.
על מגרש של 401 מ״ר, בנוי 360 מ״ר על פני 3 קומות + מרתף עם כניסה נפרדת המאפשר יחידת דיור מניבה.
בקומת המגורים 3 חדרי ילדים וסוויטת הורים מפנקת בגודל כ-60 מ״ר.
הבית שטוף שמש, עם ויטרינות גדולות המשקיפות לגינה ירוקה עם עצים.$desc$,
         'house', 'residential', 'new', 'pending', 'agent'
  from b
  cross join (select id from auth.users where email = 'pasham1991@gmail.com') u
  where not exists (                                   -- don't duplicate on a re-run
    select 1 from public.listings x
    where x.building_id = b.id and x.title = 'בית בודד באבן יהודה'
  )
  returning id
)
insert into public.listing_contacts (listing_id, name, phone, email, role, whatsapp, sort)
select l.id, 'ניצן גלנטר', '053-5349629', null, 'יועצת נדל״ן', true, 0
from l;

select 'created (or already existed) — complete price & location in admin, then approve' as note;
