-- BlockView — seed the 20 demo properties into YOUR account as approved listings.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run (won't duplicate).
--
-- Change this email if you want them under a different account:
--   pasham1991@gmail.com

-- 1) Allow trusted server context (SQL editor / service role, where auth.uid() is null)
--    to set status directly. Real users always have auth.uid(), so the
--    "no self-approval" guard still applies to every client request.
--    (Anonymous clients cannot insert at all: agent_id is NOT NULL and RLS
--     requires agent_id = auth.uid().)
create or replace function public.enforce_listing_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then          -- trusted server-side context
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status = 'approved' and not public.is_admin() then
      new.status := 'pending';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.status is distinct from old.status
       and new.status = 'approved' and not public.is_admin() then
      new.status := old.status;       -- silently refuse self-approval
    end if;
  end if;
  return new;
end; $$;

-- 2) Insert the demo listings (skips any that already exist)
insert into public.listings
  (building_id, agent_id, poster_type, deal, price, rooms, size, floor,
   title, description, type, age, furnished, pets, parking, elevator, status)
select v.building_id, u.id, 'agent', v.deal, v.price, v.rooms, v.size, v.floor,
       v.title, v.description, v.type, v.age, v.furnished, v.pets, v.parking, v.elevator, 'approved'
from (values
  ('b1','sale',3250000,3,78,2,   'דירת 3 חדרים משופצת',        'דירה משופצת מן היסוד בלב העיר, מוארת ומאווררת עם כיווני אוויר מצוינים.','flat','old',false,true ,true ,false),
  ('b1','rent',7800   ,2,55,4,   'דירת 2 חדרים עם מרפסת',      'דירה נעימה עם מרפסת שמש, קרובה לתחבורה ציבורית ובתי קפה.','flat','old',true ,false,false,true ),
  ('b1','sale',5900000,4,132,8,  'פנטהאוז 4 חדרים',            'פנטהאוז מרווח עם נוף פתוח לעיר, מרפסת גדולה וחניה בטאבו.','flat','new',true ,true ,true ,true ),
  ('b2','rent',9500   ,3,90,11,  'דירת 3 חדרים מפוארת',        'דירה מפוארת בקומה גבוהה עם נוף, מטבח מאובזר ומעלית.','flat','new',true ,false,true ,true ),
  ('b2','rent',6200   ,1,38,6,   'סטודיו מעוצב',               'סטודיו מעוצב בקפידה, מתאים לרווקים או זוג צעיר.','flat','new',true ,false,false,true ),
  ('b3','sale',2450000,2,52,1,   'דירת 2 חדרים לשיפוץ',        'הזדמנות למשקיעים - דירה לשיפוץ במיקום מרכזי מבוקש.','flat','old',false,true ,false,false),
  ('b3','sale',3100000,3,74,3,   'דירת 3 חדרים מוארת',         'דירה מוארת עם חלונות גדולים ומרפסת קטנה, קרובה להכל.','flat','old',false,false,true ,false),
  ('b3','rent',5400   ,1,42,2,   'דירת חדר וחצי',              'דירה קומפקטית ונוחה במיקום מעולה, מתאימה לסטודנטים.','flat','old',true ,false,false,false),
  ('b3','rent',8100   ,3,80,4,   'דירת 3 חדרים משופצת',        'דירה משופצת עם מעלית וחניה, מתאימה למשפחה.','flat','old',true ,true ,true ,true ),
  ('b4','rent',6800   ,2,48,2,   'דירת 2 חדרים ברחוב שינקין',  'במיקום הכי מבוקש בעיר - שינקין. קרוב לבתי קפה וחנויות.','flat','old',true ,true ,false,false),
  ('b5','sale',4200000,4,110,5,  'דירת 4 חדרים עם חניה',       'דירה מרווחת למשפחה עם חניה בטאבו, מעלית ומחסן.','flat','new',false,false,true ,true ),
  ('b5','sale',2790000,2,58,2,   'דירת 2 חדרים',               'דירה נוחה במיקום מרכזי, מתאימה למגורים או השקעה.','flat','old',false,true ,false,false),
  ('b6','sale',6500000,5,165,12, 'פנטהאוז 5 חדרים + גג',       'פנטהאוז יוקרתי עם גג פרטי ונוף פנורמי לים ולעיר.','house','new',true ,true ,true ,true ),
  ('b6','rent',12000  ,4,120,9,  'דירת 4 חדרים מפוארת',        'דירה מפוארת בקומה גבוהה, מאובזרת במלואה עם חניה.','flat','new',true ,false,true ,true ),
  ('b6','rent',7200   ,2,62,3,   'דירת 2.5 חדרים',             'דירה נעימה ומוארת, קרובה לפארק ולתחבורה.','flat','old',false,true ,false,false),
  ('b7','rent',5900   ,2,46,1,   'דירת 2 חדרים בפלורנטין',     'בלב פלורנטין התוססת - דירה עם אופי במחיר נוח.','flat','old',false,true ,false,false),
  ('b7','rent',4500   ,1,32,2,   'סטודיו צעיר',                'סטודיו קטן ונעים באזור הכי צעיר בעיר.','flat','old',true ,false,false,false),
  ('b7','sale',2150000,2,44,3,   'דירת 2 חדרים להשקעה',        'נכס מניב עם תשואה טובה באזור מתפתח.','flat','old',false,false,false,false),
  ('b8','sale',3690000,3,82,4,   'דירת 3 חדרים בבניין בוטיק',  'דירה בבניין בוטיק שקט ומטופח, עם מעלית וחניה.','flat','new',true ,false,true ,true ),
  ('b8','rent',8800   ,3,78,5,   'דירת 3 חדרים חדשה',          'דירה חדשה לחלוטין, מאובזרת ומוכנה לכניסה מיידית.','flat','new',true ,true ,true ,true )
) as v(building_id, deal, price, rooms, size, floor, title, description, type, age, furnished, pets, parking, elevator)
cross join (select id from auth.users where email = 'pasham1991@gmail.com') u
where not exists (
  select 1 from public.listings l
  where l.agent_id = u.id and l.building_id = v.building_id and l.title = v.title
);

-- how many you now have
select status, count(*) from public.listings
where agent_id = (select id from auth.users where email = 'pasham1991@gmail.com')
group by status;
