-- BlockView — offices Phase 2: add agents (invite / vouch / accept / remove).
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
-- Requires 34_offices.sql.
--
-- An approved office's owner may add agents WITHOUT the admin queue ("vouch").
-- The trust gate is the office being approved — everything below refuses to act
-- for an owner whose office is not approved.
--
-- SECURITY VERDICT — safe, but this is the sensitive piece, so read the guards:
--   * every RPC is SECURITY DEFINER with search_path pinned and requires auth;
--   * granting the 'agent' role is normally blocked by protect_profile_fields.
--     We add ONE narrow bypass: a transaction-local flag `bv.role_grant` that
--     only these definer functions set, and only around granting 'agent' (never
--     'admin', never 'plan'). A regular user can't set the flag — they can only
--     call the granted RPCs, which first prove the caller owns an APPROVED office;
--   * a target that is already an admin, or already active in another office, is
--     refused. The one-office rule is enforced by a unique index;
--   * removing a member never removes the owner and never touches roles/plans.

-- uniqueness so upserts and invites don't duplicate
create unique index if not exists office_members_office_user
  on public.office_members (office_id, user_id) where user_id is not null;
create unique index if not exists office_members_office_email
  on public.office_members (office_id, lower(invited_email)) where invited_email is not null;

-- ========================== protect_profile_fields: allow the scoped grant ==
create or replace function public.protect_profile_fields()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  caller_is_admin boolean;
  role_grant boolean := coalesce(current_setting('bv.role_grant', true), '') = '1';
begin
  caller_is_admin := exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');

  -- role: admin, or the narrow vouch bypass, may change it; never to 'admin'
  if new.role is distinct from old.role then
    if auth.uid() is not null and not caller_is_admin and not role_grant then
      raise exception 'FORBIDDEN_FIELD_CHANGE' using errcode = 'P0001';
    end if;
    if role_grant and new.role = 'admin' then          -- the bypass can never mint an admin
      raise exception 'FORBIDDEN_FIELD_CHANGE' using errcode = 'P0001';
    end if;
  end if;

  -- plan: only an admin, no bypass (guards free Pro)
  if new.plan is distinct from old.plan then
    if auth.uid() is not null and not caller_is_admin then
      raise exception 'FORBIDDEN_FIELD_CHANGE' using errcode = 'P0001';
    end if;
  end if;

  -- consent timestamp: recorded by the client, never chosen by it
  if new.terms_accepted_at is distinct from old.terms_accepted_at then
    if auth.uid() is not null and not caller_is_admin then
      if new.terms_accepted_at is null then new.terms_accepted_at := old.terms_accepted_at;
      else new.terms_accepted_at := now(); end if;
    end if;
  end if;

  return new;
end; $$;

-- grant the agent role through the bypass, in one place
create or replace function public.grant_agent_role(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('bv.role_grant', '1', true);
  update public.profiles set role = 'agent' where id = p_user and role = 'user';
  perform set_config('bv.role_grant', '', true);
end $$;
revoke all on function public.grant_agent_role(uuid) from public, anon, authenticated;

-- ================================================= owner adds / invites =====
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
    on conflict (office_id, user_id) do update set status = 'active', joined_at = now();
    perform public.grant_agent_role(v_target);         -- vouch: skip the admin queue
    return jsonb_build_object('status', 'active', 'user_id', v_target);
  else
    insert into public.office_members (office_id, invited_email, member_role, status, invited_by)
    values (p_office, v_norm, 'agent', 'invited', auth.uid())
    on conflict (office_id, lower(invited_email)) do nothing;
    return jsonb_build_object('status', 'invited', 'email', v_norm);
  end if;
end $$;

-- ===================== the invited user activates it when they sign in ======
create or replace function public.office_accept_invites()
returns uuid language plpgsql security definer set search_path = public as $$
declare v_email text; v_office uuid; v_id uuid;
begin
  if auth.uid() is null then return null; end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  if v_email is null then return null; end if;
  if exists (select 1 from public.office_members where user_id = auth.uid() and status = 'active') then
    return null;                                        -- already in an office
  end if;
  select id, office_id into v_id, v_office from public.office_members
   where lower(invited_email) = v_email and status = 'invited' and user_id is null
   order by created_at limit 1;
  if v_id is null then return null; end if;
  -- only if their (approved) office is still approved
  if not exists (select 1 from public.offices o where o.id = v_office and o.status = 'approved') then
    return null;
  end if;
  update public.office_members set user_id = auth.uid(), status = 'active', joined_at = now() where id = v_id;
  perform public.grant_agent_role(auth.uid());
  return v_office;
end $$;

-- ============================================ owner removes / member leaves ==
create or replace function public.office_remove_member(p_office uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.offices where id = p_office and owner_id = auth.uid())
     and not public.is_admin() then
    raise exception 'NOT_OFFICE_OWNER' using errcode = 'P0001';
  end if;
  delete from public.office_members
   where office_id = p_office and user_id = p_user and member_role <> 'owner';
  -- the person stays an agent; they're just no longer in this office.
end $$;

create or replace function public.office_leave()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  delete from public.office_members where user_id = auth.uid() and member_role <> 'owner';
end $$;

revoke all on function public.office_add_agent(uuid, text)      from public, anon;
revoke all on function public.office_accept_invites()           from public, anon;
revoke all on function public.office_remove_member(uuid, uuid)  from public, anon;
revoke all on function public.office_leave()                    from public, anon;
grant execute on function public.office_add_agent(uuid, text)      to authenticated;
grant execute on function public.office_accept_invites()           to authenticated;
grant execute on function public.office_remove_member(uuid, uuid)  to authenticated;
grant execute on function public.office_leave()                    to authenticated;

select 'offices Phase 2 ready — owners can add/invite agents (vouch)' as note;
