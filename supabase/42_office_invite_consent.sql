-- BlockView — offices: adding an agent now INVITES them; they must accept.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
-- Requires 36/40/41. Supersedes office_add_agent and office_accept_invites.
--
-- Before, adding a registered user auto-joined them and made them an agent with
-- no say. Now every add creates a 'invited' row; the person accepts (or declines)
-- from the CRM, and only on accept do they join, become an agent, and have their
-- listings roll up. An email is sent on invite (pg_net -> /api/office-invite).
--
-- SECURITY VERDICT — safe. Same guards: SECURITY DEFINER, search_path pinned,
-- office_add_agent still refuses anyone who is not the owner of an APPROVED
-- office and never touches an admin. The role grant only happens when the invited
-- person themselves accepts (office_respond_invite runs as that person). The
-- one-office rule is enforced at accept time.

-- ---- add = invite (registered user or plain email), never auto-join ----
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
  if v_target is not null and exists (select 1 from public.profiles where id = v_target and role = 'admin') then
    raise exception 'TARGET_IS_ADMIN' using errcode = 'P0001';
  end if;
  -- already an active member here? nothing to do
  if v_target is not null and exists (
      select 1 from public.office_members where office_id = p_office and user_id = v_target and status = 'active') then
    raise exception 'ALREADY_MEMBER' using errcode = 'P0001';
  end if;

  -- create / refresh the invite (never active, no role grant)
  if v_target is not null then
    insert into public.office_members (office_id, user_id, invited_email, member_role, status, invited_by)
    values (p_office, v_target, v_norm, 'agent', 'invited', auth.uid())
    on conflict (office_id, user_id) where user_id is not null
      do update set status = 'invited', invited_email = v_norm, invited_by = auth.uid();
  else
    insert into public.office_members (office_id, invited_email, member_role, status, invited_by)
    values (p_office, v_norm, 'agent', 'invited', auth.uid())
    on conflict (office_id, lower(invited_email)) where invited_email is not null
      do update set invited_by = auth.uid();
  end if;
  return jsonb_build_object('status', 'invited', 'email', v_norm);
end $$;

-- ---- what am I invited to? (shown in the CRM) ----
create or replace function public.office_pending_invites()
returns table (office_id uuid, office_name text) language sql stable
security definer set search_path = public as $$
  select m.office_id, o.name
  from public.office_members m
  join public.offices o on o.id = m.office_id
  where m.status = 'invited'
    and o.status = 'approved'
    and (m.user_id = auth.uid()
         or lower(m.invited_email) = (select lower(email) from auth.users where id = auth.uid()));
$$;

-- ---- accept or decline an invite (run BY the invited person) ----
create or replace function public.office_respond_invite(p_office uuid, p_accept boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_email text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  select id into v_id from public.office_members
   where office_id = p_office and status = 'invited'
     and (user_id = auth.uid() or lower(invited_email) = v_email)
   limit 1;
  if v_id is null then raise exception 'NO_INVITE' using errcode = 'P0001'; end if;

  if not p_accept then
    delete from public.office_members where id = v_id;
    return null;
  end if;

  if not exists (select 1 from public.offices where id = p_office and status = 'approved') then
    raise exception 'OFFICE_NOT_APPROVED' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.office_members where user_id = auth.uid() and status = 'active') then
    raise exception 'ALREADY_IN_OFFICE' using errcode = 'P0001';
  end if;

  update public.office_members set user_id = auth.uid(), status = 'active', joined_at = now() where id = v_id;
  perform public.grant_agent_role(auth.uid());
  update public.listings set office_id = p_office where agent_id = auth.uid();
  return p_office;
end $$;

-- the old auto-accept is retired; keep the name callable but do nothing, so any
-- stale client that still calls it neither joins anyone nor errors.
create or replace function public.office_accept_invites()
returns uuid language sql security definer set search_path = public as $$ select null::uuid $$;

revoke all on function public.office_add_agent(uuid, text)          from public, anon;
revoke all on function public.office_pending_invites()              from public, anon;
revoke all on function public.office_respond_invite(uuid, boolean)  from public, anon;
grant execute on function public.office_add_agent(uuid, text)          to authenticated;
grant execute on function public.office_pending_invites()              to authenticated;
grant execute on function public.office_respond_invite(uuid, boolean)  to authenticated;

-- ---- email the invited person when a pending invite is created ----
create or replace function public.notify_office_invite()
returns trigger language plpgsql as $$
begin
  if new.status = 'invited' then
    perform net.http_post(
      url     := 'https://blockview.co.il/api/office-invite',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := jsonb_build_object('member_id', new.id));
  end if;
  return new;
exception when others then return new;
end $$;

drop trigger if exists office_members_invite_notify on public.office_members;
create trigger office_members_invite_notify after insert or update of status on public.office_members
  for each row execute procedure public.notify_office_invite();

select 'office invites now require the agent to accept' as note;
