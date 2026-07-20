-- BlockView — superadmin console support.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.

-- ============================================== email on the profile ======
-- Admins need to identify users. auth.users isn't readable from the client,
-- so mirror the email onto the (RLS-protected) profile row.
alter table public.profiles add column if not exists email text;

-- backfill existing users
update public.profiles p
set    email = u.email
from   auth.users u
where  u.id = p.id and p.email is distinct from u.email;

-- keep it in sync for new signups
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, plan, email) values (new.id, 'free', new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================ admin access to profiles ====
-- (is_admin() is SECURITY DEFINER, so it reads profiles without recursing
--  through RLS. Regular users keep seeing only their own row.)
drop policy if exists profiles_admin_select on public.profiles;
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_select on public.profiles for select
  using (public.is_admin());
create policy profiles_admin_update on public.profiles for update
  using (public.is_admin()) with check (public.is_admin());

-- ================================================= admin housekeeping ====
-- admins may remove a building (listings cascade)
drop policy if exists buildings_delete on public.buildings;
create policy buildings_delete on public.buildings for delete using (public.is_admin());

-- quick sanity check
select role, count(*) from public.profiles group by role;
