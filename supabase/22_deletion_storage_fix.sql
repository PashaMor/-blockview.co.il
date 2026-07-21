-- BlockView — fix account deletion: stop deleting storage rows from SQL.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
-- Replaces the storage part of 20_account_deletion.sql.
--
-- Supabase blocks DELETE on storage.objects from SQL:
--   "Direct deletion from storage tables is not allowed. Use the Storage API"
-- so purge_user_files() made every deletion fail. Files are now removed through
-- the Storage API by the client BEFORE the account is deleted, and these
-- functions only do what the database is allowed to do.
--
-- Worst case, if the file cleanup fails, the account is still deleted and some
-- images are orphaned in the bucket — the account data is what matters, and an
-- orphaned image is no longer reachable from any listing.

-- ============================================== drop the offending helper ==
drop function if exists public.purge_user_files(uuid);

-- ================================================= delete my own account ==
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
declare
  me uuid := auth.uid();
  admin_count int;
begin
  if me is null then
    raise exception 'NOT_SIGNED_IN' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.profiles where id = me and role = 'admin') then
    select count(*) into admin_count from public.profiles where role = 'admin';
    if admin_count <= 1 then
      raise exception 'LAST_ADMIN' using errcode = 'P0001';
    end if;
  end if;

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
    raise exception 'USE_SELF_DELETE' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users where id = target) then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.profiles where id = target and role = 'admin') then
    select count(*) into admin_count from public.profiles where role = 'admin';
    if admin_count <= 1 then
      raise exception 'LAST_ADMIN' using errcode = 'P0001';
    end if;
  end if;

  delete from auth.users where id = target;
end; $$;

revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- ===================== let an admin clear another user's files via the API ==
-- Users can already manage their own folder (the "(storage.foldername(name))[1]
-- = auth.uid()" policies). An admin deleting someone else's account needs to be
-- able to remove that person's files too — still only in these two buckets.
drop policy if exists "admin manage listing photos" on storage.objects;
drop policy if exists "admin manage agent logos"    on storage.objects;

create policy "admin manage listing photos" on storage.objects for all
  using (bucket_id = 'listing-photos' and public.is_admin())
  with check (bucket_id = 'listing-photos' and public.is_admin());

create policy "admin manage agent logos" on storage.objects for all
  using (bucket_id = 'agent-logos' and public.is_admin())
  with check (bucket_id = 'agent-logos' and public.is_admin());

select 'account deletion no longer touches storage tables' as note;
