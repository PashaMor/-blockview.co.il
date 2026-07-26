-- BlockView — offices Phase 4: transfer ownership.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
-- Requires 36_office_members.sql.
--
-- Hands an office to one of its existing active members. The old owner becomes
-- a regular agent-member; the new owner is marked 'owner'. Only the current
-- owner (or an admin) may do it, and only to someone already in the office.
--
-- SECURITY VERDICT — safe. SECURITY DEFINER, search_path pinned, auth required.
-- It changes only offices.owner_id and two office_members rows; it grants no
-- role and touches no other table.

create or replace function public.transfer_office_ownership(p_office uuid, p_new_owner uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_old uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  select owner_id into v_old from public.offices where id = p_office;
  if v_old is null then raise exception 'OFFICE_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_old <> auth.uid() and not public.is_admin() then
    raise exception 'NOT_OFFICE_OWNER' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.office_members
                 where office_id = p_office and user_id = p_new_owner and status = 'active') then
    raise exception 'NEW_OWNER_NOT_MEMBER' using errcode = 'P0001';
  end if;

  update public.offices set owner_id = p_new_owner, updated_at = now() where id = p_office;
  update public.office_members set member_role = 'owner' where office_id = p_office and user_id = p_new_owner;
  update public.office_members set member_role = 'agent' where office_id = p_office and user_id = v_old;
end $$;

revoke all on function public.transfer_office_ownership(uuid, uuid) from public, anon;
grant execute on function public.transfer_office_ownership(uuid, uuid) to authenticated;

select 'office ownership transfer ready' as note;
