-- BlockView — demo buildings and listings OUTSIDE Tel Aviv, so the city filter
-- and the new fly-to-results behaviour can actually be tested.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- Everything lands under pasham1991@gmail.com, approved, exactly like
-- 04_demo_listings.sql. Until now every building was in תל אביב-יפו, so
-- picking a city in the filter had nothing to switch between.
--
-- Coordinates are real street locations in each city, so the camera flies
-- somewhere sensible. Buildings are verified = true: they are ours, not
-- user-submitted, so they belong on the map straight away.

-- ============================================================= buildings ==
insert into public.buildings (id, name, address, city, lng, lat, w, h, height, verified, source)
values
  -- ירושלים
  ('j1', 'יפו 97',        'רחוב יפו 97, ירושלים',            'ירושלים',      35.21160, 31.78520, 0.00028, 0.00034, 28, true, 'manual'),
  ('j2', 'עמק רפאים 24',  'עמק רפאים 24, ירושלים',           'ירושלים',      35.21860, 31.76430, 0.00026, 0.00030, 18, true, 'manual'),
  -- חיפה
  ('h1', 'הנביאים 15',    'רחוב הנביאים 15, חיפה',           'חיפה',         34.99230, 32.81420, 0.00030, 0.00032, 34, true, 'manual'),
  ('h2', 'מוריה 88',      'שדרות מוריה 88, חיפה',            'חיפה',         34.99870, 32.79260, 0.00028, 0.00030, 22, true, 'manual'),
  -- באר שבע
  ('s1', 'רגר 42',        'שדרות רגר 42, באר שבע',           'באר שבע',      34.79180, 31.25180, 0.00030, 0.00034, 26, true, 'manual'),
  -- נתניה
  ('n1', 'הרצל 30',       'רחוב הרצל 30, נתניה',             'נתניה',        34.85560, 32.32180, 0.00028, 0.00032, 30, true, 'manual'),
  ('n2', 'ניצה 12',       'שדרות ניצה 12, נתניה',            'נתניה',        34.85110, 32.32750, 0.00032, 0.00034, 44, true, 'manual'),
  -- הרצליה
  ('z1', 'סוקולוב 50',    'רחוב סוקולוב 50, הרצליה',         'הרצליה',       34.84350, 32.16400, 0.00026, 0.00030, 20, true, 'manual')
on conflict (id) do nothing;

-- ============================================================== listings ==
-- agent_id comes from the account, so RLS and set_lead_agent keep working.
insert into public.listings
  (building_id, agent_id, poster_type, deal, price, rooms, size, floor,
   title, description, type, age, furnished, pets, parking, elevator, status)
select v.building_id, u.id, 'agent', v.deal, v.price, v.rooms, v.size, v.floor,
       v.title, v.description, v.type, v.age, v.furnished, v.pets, v.parking, v.elevator, 'approved'
from (values
  -- ירושלים
  ('j1','sale',2890000,3, 82,3, 'דירת 3 חדרים במרכז העיר',   'דירה מוארת במרחק הליכה משוק מחנה יהודה ומהרכבת הקלה. משופצת חלקית, מטבח חדש.','flat','old',false,true ,false,false),
  ('j1','rent',6200   ,2, 58,1, 'דירת 2 חדרים להשכרה',       'דירה נעימה בבניין אבן ירושלמי, מרוהטת במלואה, מתאימה לזוג או לסטודנטים.','flat','old',true ,false,false,false),
  ('j2','sale',4750000,4,118,2, 'דירת 4 חדרים בגרמנית',      'דירה מרווחת במושבה הגרמנית, שלושה כיווני אוויר, מרפסת שמש וחניה בטאבו.','flat','old',false,true ,true ,true ),
  -- חיפה
  ('h1','sale',1980000,4,105,5, 'דירת 4 חדרים עם נוף לים',   'נוף פתוח למפרץ חיפה, דירה מרווחת בבניין מטופח עם מעלית וחניה.','flat','old',false,true ,true ,true ),
  ('h1','rent',4300   ,3, 76,2, 'דירת 3 חדרים בהדר',         'דירה משופצת ברחוב שקט, קרובה לטכניון ולתחבורה ציבורית.','flat','old',false,true ,false,false),
  ('h2','sale',3400000,5,140,4, 'דירת 5 חדרים בכרמל',        'דירת גן בכרמל הצרפתי, גינה פרטית, ממ"ד ושתי חניות.','house','new',false,true ,true ,true ),
  -- באר שבע
  ('s1','sale',1450000,3, 88,6, 'דירת 3 חדרים ברמות',        'דירה במחיר נוח באזור מתפתח, קרובה לאוניברסיטת בן גוריון ולבית החולים סורוקה.','flat','old',false,true ,true ,true ),
  ('s1','rent',3200   ,4,102,3, 'דירת 4 חדרים להשכרה',       'דירה מרווחת ומוארת, מתאימה למשפחה או לשותפים, חניה חופשית בשפע.','flat','old',true ,true ,true ,true ),
  -- נתניה
  ('n1','sale',2650000,3, 84,4, 'דירת 3 חדרים במרכז נתניה',  'דירה במרחק הליכה מהים ומכיכר העצמאות, בניין עם מעלית ולובי מטופח.','flat','old',false,false,true ,true ),
  ('n2','sale',6900000,5,165,12,'פנטהאוז 5 חדרים מול הים',   'פנטהאוז עם מרפסת ענקית ונוף פתוח לים התיכון, שתי חניות ומחסן.','flat','new',true ,true ,true ,true ),
  ('n2','rent',9500   ,4,120,7, 'דירת 4 חדרים מול הים',      'דירה חדשה בבניין בוטיק, מרוהטת ברמה גבוהה, כניסה מיידית.','flat','new',true ,false,true ,true ),
  -- הרצליה
  ('z1','sale',5200000,4,124,3, 'דירת 4 חדרים בהרצליה',      'דירה בשכונה מבוקשת, קרובה לבתי ספר ולפארק, מרפסת שמש גדולה.','flat','new',false,true ,true ,true ),
  ('z1','rent',8800   ,3, 95,2, 'דירת 3 חדרים להשכרה',       'דירה מעוצבת עם מטבח פתוח, ממ"ד וחניה תת-קרקעית.','flat','new',true ,true ,true ,true )
) as v(building_id, deal, price, rooms, size, floor, title, description, type, age, furnished, pets, parking, elevator)
cross join (select id from auth.users where email = 'pasham1991@gmail.com') u
where not exists (
  select 1 from public.listings l
  where l.building_id = v.building_id and l.title = v.title and l.agent_id = u.id
);

-- ============================================================== contacts ==
-- Without these the new listings have no one to contact and the 💬 button
-- never appears. Same pattern as 11_demo_contacts.sql: only listings of the
-- demo account that have no contact yet, so a real owner is never overwritten.
insert into public.listing_contacts (listing_id, name, phone, email, role, whatsapp, sort)
select l.id, 'ענבל לוי', '052-3125235', u.email, 'בעל הנכס', true, 0
from   public.listings l
join   auth.users u on u.id = l.agent_id
where  u.email = 'pasham1991@gmail.com'
  and  l.building_id in ('j1','j2','h1','h2','s1','n1','n2','z1')
  and  not exists (select 1 from public.listing_contacts c where c.listing_id = l.id);

-- ================================================================ check ==
select b.city, count(l.id) as listings
from   public.buildings b
left   join public.listings l on l.building_id = b.id and l.status = 'approved'
group  by b.city
order  by b.city;
