-- BlockView — add an "agricultural" listing category (farm / orchard / vineyard /
-- field). Run in Supabase: SQL Editor -> paste -> Run. Safe to re-run.
-- Extends supabase/25_listing_fields.sql (residential + commercial).
--
-- SECURITY VERDICT — SAFE. Only widens two CHECK constraints to accept a new
-- category and its property types. No RLS/policy/privilege change, no destructive
-- op, no data touched. Existing rows are unaffected, and the category/type pairing
-- constraint stays NOT VALID so historical rows are never re-validated.

-- 1) allow the new category value
alter table public.listings drop constraint if exists listings_category_chk;
alter table public.listings add constraint listings_category_chk
  check (category in ('residential','commercial','agricultural'));

-- 2) allow the agricultural property types alongside the existing ones
alter table public.listings drop constraint if exists listings_type_chk;
alter table public.listings add constraint listings_type_chk
  check (type in ('flat','house','penthouse','studio',       -- residential
                  'office','shop','warehouse','other',         -- commercial
                  'farm','orchard','vineyard','field'));        -- agricultural

-- 3) keep the category/type pairing honest (a farm can't be a "flat")
alter table public.listings drop constraint if exists listings_category_type_chk;
alter table public.listings add constraint listings_category_type_chk check (
      (category = 'residential'  and type in ('flat','house','penthouse','studio'))
   or (category = 'commercial'   and type in ('office','shop','warehouse','other'))
   or (category = 'agricultural' and type in ('farm','orchard','vineyard','field'))
) not valid;

select 'agricultural category + types (farm/orchard/vineyard/field) added' as note;