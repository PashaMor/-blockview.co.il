-- BlockView — account deletion: by the user themselves, and by an admin.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- The privacy policy promises "לבקש את מחיקת החשבון". This makes it self-service
-- rather than an email request, which is also what the GDPR expects.
--
-- Deleting the auth.users row cascades to everything that references it:
--   profiles, favorites, follows, notes, listings (-> listing_photos,
--   listing_contacts, listing_views, leads), agent_applications, agent_profiles.
-- Uploaded FILES are not covered by a foreign key, so both functions clear the
-- user's folder in storage as well.
--
-- Why SECURITY DEFINER rather than an HTTP endpoint: this runs as the function
-- owner inside the database, so no service key has to exist anywhere a request
-- can reach. Each function decides for itself who is allowed to call it.

-- =================================================== shared file cleanup ==
create or replace function public.purge_user_files(target uuid)
returns void language plpgsql security definer set search_path = public, storage as $$
begin
  delete from storage.objects
  where bucket_id in ('listing-photos', 'agent-logos')
    and (storage.foldername(name))[1] = target::text;
end; $$;

revoke all on function public.purge_user_files(uuid) from public, anon, authenticated;

-- ======================================================= delete my own ====
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
declare
  me uuid := auth.uid();
  admin_count int;
begin
  if me is null then
    raise exception 'NOT_SIGNED_IN' using errcode = 'P0001';
  end if;

  -- never let the last admin delete the way into the console
  if exists (select 1 from public.profiles where id = me and role = 'admin') then
    select count(*) into admin_count from public.profiles where role = 'admin';
    if admin_count <= 1 then
      raise exception 'LAST_ADMIN' using errcode = 'P0001';
    end if;
  end if;

  perform public.purge_user_files(me);
  delete from auth.users where id = me;      -- cascades through every table
end; $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ==================================================== delete by an admin ==
create or replace function public.admin_delete_user(target uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
declare
  admin_count int;
begin
  if not public.is_admin() then               -- role admin AND aal2 (2FA)
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if target is null then
    raise exception 'NO_TARGET' using errcode = 'P0001';
  end if;
  if target = auth.uid() then
    raise exception 'USE_SELF_DELETE' using errcode = 'P0001';   -- no accidental self-wipe
  end if;
  if not exists (select 1 from auth.users where id = target) then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- deleting another admin is allowed, but never the last one
  if exists (select 1 from public.profiles where id = target and role = 'admin') then
    select count(*) into admin_count from public.profiles where role = 'admin';
    if admin_count <= 1 then
      raise exception 'LAST_ADMIN' using errcode = 'P0001';
    end if;
  end if;

  perform public.purge_user_files(target);
  delete from auth.users where id = target;
end; $$;

revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;

select count(*) as users, count(*) filter (where role = 'admin') as admins
from   public.profiles;
