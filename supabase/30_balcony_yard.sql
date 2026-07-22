-- BlockView — balcony (מרפסת) and yard (חצר) on a listing, each with a size.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- Two boolean features plus an optional size in m² for each. The size is only
-- meaningful when the feature is present, and it must be positive — enforced
-- here, not just in the form.

alter table public.listings add column if not exists balcony      boolean not null default false;
alter table public.listings add column if not exists balcony_size numeric;
alter table public.listings add column if not exists yard         boolean not null default false;
alter table public.listings add column if not exists yard_size    numeric;

-- a size, when given, is positive and sane (<= 100000 m²)
do $$ begin
  alter table public.listings add constraint listings_balcony_size_chk
    check (balcony_size is null or (balcony_size > 0 and balcony_size <= 100000));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.listings add constraint listings_yard_size_chk
    check (yard_size is null or (yard_size > 0 and yard_size <= 100000));
exception when duplicate_object then null; end $$;

-- a size without the feature is contradictory; NOT VALID so existing rows are left alone
do $$ begin
  alter table public.listings add constraint listings_balcony_size_needs_flag
    check (balcony_size is null or balcony) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.listings add constraint listings_yard_size_needs_flag
    check (yard_size is null or yard) not valid;
exception when duplicate_object then null; end $$;

select 'balcony & yard (with sizes) added' as note;
