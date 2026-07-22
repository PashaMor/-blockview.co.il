-- BlockView — a user's home location (where "reset view" flies to).
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- Just three columns on the user's own profile row. profiles already has RLS
-- (a user reads/updates only their own row), and protect_profile_fields only
-- guards role/plan, so these are freely settable by the owner and nobody else.

alter table public.profiles add column if not exists home_lat   double precision;
alter table public.profiles add column if not exists home_lng   double precision;
alter table public.profiles add column if not exists home_label text;

-- keep coordinates sane when set
do $$ begin
  alter table public.profiles add constraint profiles_home_coords_chk check (
    (home_lat is null and home_lng is null)
    or (home_lat between -90 and 90 and home_lng between -180 and 180)
  );
exception when duplicate_object then null; end $$;

select 'home location columns added to profiles' as note;
