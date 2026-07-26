-- BlockView — roll a member's EXISTING listings into the office when they join.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
-- Requires 36/37/40. Supersedes the join-side of those functions.
--
-- The office_id roll-up only fired for listings written AFTER a membership
-- existed, so an owner's (or agent's) listings created before the office stayed
-- office_id = null and the office looked empty. Now every function that makes
-- someone an active member also stamps office_id onto that person's listings,
-- and removing/leaving clears it. Includes a one-time backfill for the current
-- state.
--
-- SECURITY VERDICT — safe. All SECURITY DEFINER, search_path pinned, same owner-
-- of-approved-office guards as before. office_id is written only for listings
-- whose agent_id is the member being (un)joined; no other table changes, no role
-- change, no admin grant.

-- the owner's listings join when the office is created
create or replace function public.add_office_owner_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.office_members (office_id, user_id, member_role, status, joined_at)
  values (new.id, new.owner_id, 'owner', 'active', now())
  on conflict do nothing;
  update public.listings set office_id = new.id where agent_id = new.owner_id;
  return new;
end $$;

-- add / invite an agent: stamp their listings on the spot
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
    update public.listings set office_id = p_office where agent_id = v_target;
    return jsonb_build_object('status', 'active', 'user_id', v_target);
  else
    insert into public.office_members (office_id, invited_email, member_role, status, invited_by)
    values (p_office, v_norm, 'agent', 'invited', auth.uid())
    on conflict (office_id, lower(invited_email)) where invited_email is not null
      do nothing;
    return jsonb_build_object('status', 'invited', 'email', v_norm);
  end if;
end $$;

-- accept an invite: stamp the new member's listings
create or replace function public.office_accept_invites()
returns uuid language plpgsql security definer set search_path = public as $$
declare v_email text; v_office uuid; v_id uuid;
begin
  if auth.uid() is null then return null; end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  if v_email is null then return null; end if;
  if exists (select 1 from public.office_members where user_id = auth.uid() and status = 'active') then return null; end if;
  select id, office_id into v_id, v_office from public.office_members
   where lower(invited_email) = v_email and status = 'invited' and user_id is null
   order by created_at limit 1;
  if v_id is null then return null; end if;
  if not exists (select 1 from public.offices o where o.id = v_office and o.status = 'approved') then return null; end if;
  update public.office_members set user_id = auth.uid(), status = 'active', joined_at = now() where id = v_id;
  perform public.grant_agent_role(auth.uid());
  update public.listings set office_id = v_office where agent_id = auth.uid();
  return v_office;
end $$;

-- removing / leaving: the listings leave the office too
create or replace function public.office_remove_member(p_office uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.offices where id = p_office and owner_id = auth.uid()) and not public.is_admin() then
    raise exception 'NOT_OFFICE_OWNER' using errcode = 'P0001';
  end if;
  delete from public.office_members where office_id = p_office and user_id = p_user and member_role <> 'owner';
  update public.listings set office_id = null where agent_id = p_user and office_id = p_office;
end $$;

create or replace function public.office_leave()
returns void language plpgsql security definer set search_path = public as $$
declare v_office uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  select office_id into v_office from public.office_members where user_id = auth.uid() and member_role <> 'owner' limit 1;
  delete from public.office_members where user_id = auth.uid() and member_role <> 'owner';
  if v_office is not null then update public.listings set office_id = null where agent_id = auth.uid() and office_id = v_office; end if;
end $$;

-- one-time backfill for members who are already active (e.g. the owner above)
update public.listings l
   set office_id = m.office_id
from public.office_members m
where m.user_id = l.agent_id and m.status = 'active'
  and l.office_id is distinct from m.office_id;

select count(*) filter (where office_id is not null) as listings_in_an_office from public.listings;
