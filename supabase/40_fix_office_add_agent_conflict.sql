-- BlockView — fix: office_add_agent hit "no unique or exclusion constraint
-- matching the ON CONFLICT specification".
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
-- Requires 36_office_members.sql. Replaces office_add_agent from it.
--
-- CAUSE: office_members' uniqueness is enforced by PARTIAL indexes
--   (office_id, user_id)       where user_id is not null
--   (office_id, lower(invited_email)) where invited_email is not null
-- and an ON CONFLICT that infers a partial index must repeat its WHERE predicate.
-- The function omitted them, so no index matched and adding an agent failed.
--
-- FIX: add the matching WHERE predicate to each ON CONFLICT. Logic is otherwise
-- identical to 36.
--
-- SECURITY VERDICT — unchanged from 36 and safe: SECURITY DEFINER, search_path
-- pinned, still refuses anyone who is not the owner of an APPROVED office, still
-- never grants admin.

create or replace function public.office_add_agent(p_office uuid, p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_target uuid;
  v_norm text := lower(btrim(coalesce(p_email, '')));
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  select status into v_status from public.offices where id = p_office and owner_id = auth.uid();
  if v_status is null then raise exception 'NOT_OFFICE_OWNER' using errcode = 'P0001'; end if;
  if v_status <> 'approved' then raise exception 'OFFICE_NOT_APPROVED' using errcode = 'P0001'; end if;
  if v_norm = '' or v_norm !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'BAD_EMAIL' using errcode = 'P0001';
  end if;

  select id into v_target from auth.users where lower(email) = v_norm;

  if v_target is not null then
    if exists (select 1 from public.profiles where id = v_target and role = 'admin') then
      raise exception 'TARGET_IS_ADMIN' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.office_members where user_id = v_target and status = 'active' and office_id <> p_office) then
      raise exception 'ALREADY_IN_OFFICE' using errcode = 'P0001';
    end if;
    insert into public.office_members (office_id, user_id, member_role, status, invited_by, joined_at)
    values (p_office, v_target, 'agent', 'active', auth.uid(), now())
    on conflict (office_id, user_id) where user_id is not null
      do update set status = 'active', joined_at = now();
    perform public.grant_agent_role(v_target);
    return jsonb_build_object('status', 'active', 'user_id', v_target);
  else
    insert into public.office_members (office_id, invited_email, member_role, status, invited_by)
    values (p_office, v_norm, 'agent', 'invited', auth.uid())
    on conflict (office_id, lower(invited_email)) where invited_email is not null
      do nothing;
    return jsonb_build_object('status', 'invited', 'email', v_norm);
  end if;
end $$;

revoke all on function public.office_add_agent(uuid, text) from public, anon;
grant execute on function public.office_add_agent(uuid, text) to authenticated;

select 'office_add_agent fixed — ON CONFLICT now matches the partial indexes' as note;
