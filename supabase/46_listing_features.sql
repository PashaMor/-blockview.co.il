-- BlockView — extra property features ("מה יש בנכס").
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- Adds the common Israeli listing features on top of the ones the schema already
-- has (furnished / pets / parking / elevator / balcony / yard). All booleans,
-- default false, so existing rows read as "not present" until edited.
--
-- SECURITY VERDICT — safe. Only `add column if not exists` of boolean flags; no
-- policy, trigger or privilege change, no dynamic SQL.

alter table public.listings add column if not exists accessible boolean not null default false; -- גישה לנכים
alter table public.listings add column if not exists ac         boolean not null default false; -- מיזוג
alter table public.listings add column if not exists bars       boolean not null default false; -- סורגים
alter table public.listings add column if not exists storage    boolean not null default false; -- מחסן
alter table public.listings add column if not exists solar      boolean not null default false; -- דוד שמש
alter table public.listings add column if not exists renovated  boolean not null default false; -- משופצת
alter table public.listings add column if not exists safe_room  boolean not null default false; -- ממ"ד

select 'listing feature columns added' as note;
