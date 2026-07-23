-- BlockView — real-estate offices (Phase 1: core + approval).
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- An office is a brokerage. A user creates one (it lands 'pending'), an admin
-- approves it, and only then does the owner become a trusted party who can add
-- agents (Phase 2). Approval is the trust gate — nothing an owner does carries
-- weight until their office is approved.
--
-- SECURITY VERDICT — safe. RLS on both tables. A creator cannot self-approve
-- their office (enforce_office_status, mirroring enforce_listing_status). The
-- owner is added as a member by a SECURITY DEFINER trigger (search_path pinned)
-- so membership can't be forged from the client. review_office() is admin-only
-- and requires aal2 via is_admin(). No privilege change reaches a plain user.

-- =============================================================== offices ==
create table if not exists public.offices (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  license_no text,
  phone      text,
  address    text,
  city       text,
  website    text,
  logo_path  text,                         -- object path in the agent-logos bucket
  status     text not null default 'pending' check (status in ('pending','approved','rejected','suspended')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists offices_owner_idx  on public.offices (owner_id);
create index if not exists offices_status_idx on public.offices (status);

-- ======================================================== office_members ==
create table if not exists public.office_members (
  id          uuid primary key default gen_random_uuid(),
  office_id   uuid not null references public.offices (id) on delete cascade,
  user_id     uuid references auth.users (id) on delete cascade,   -- null while only invited by email
  member_role text not null default 'agent' check (member_role in ('owner','manager','agent')),
  status      text not null default 'active' check (status in ('invited','active')),
  invited_email text,
  invited_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  joined_at   timestamptz
);
create index if not exists office_members_office_idx on public.office_members (office_id);
create index if not exists office_members_user_idx   on public.office_members (user_id);
-- one ACTIVE office per agent (the one-office-per-agent rule)
create unique index if not exists office_members_one_active
  on public.office_members (user_id) where (status = 'active' and user_id is not null);

-- ============================================ no self-approval on offices ==
create or replace function public.enforce_office_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;          -- trusted server context
  if tg_op = 'INSERT' then
    if new.status <> 'pending' and not public.is_admin() then new.status := 'pending'; end if;
  elsif tg_op = 'UPDATE' then
    if new.status is distinct from old.status and not public.is_admin() then
      new.status := old.status;                            -- only an admin moves status
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists offices_status_guard on public.offices;
create trigger offices_status_guard before insert or update on public.offices
  for each row execute procedure public.enforce_office_status();

-- ============================== the creator becomes the owner-member ======
create or replace function public.add_office_owner_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.office_members (office_id, user_id, member_role, status, joined_at)
  values (new.id, new.owner_id, 'owner', 'active', now())
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists offices_owner_member on public.offices;
create trigger offices_owner_member after insert on public.offices
  for each row execute procedure public.add_office_owner_member();

-- ==================================================================== RLS ==
alter table public.offices        enable row level security;
alter table public.office_members enable row level security;

-- offices: an approved office is public (for its public page); an owner, a
-- member, or an admin sees it in any status.
drop policy if exists offices_read on public.offices;
create policy offices_read on public.offices for select using (
  status = 'approved'
  or owner_id = auth.uid()
  or public.is_admin()
  or exists (select 1 from public.office_members m
             where m.office_id = offices.id and m.user_id = auth.uid())
);
-- anyone signed in may create an office; the status guard forces it to pending.
drop policy if exists offices_insert on public.offices;
create policy offices_insert on public.offices for insert with check (owner_id = auth.uid());
-- the owner edits their office (branding); status is still gated by the trigger.
drop policy if exists offices_update on public.offices;
create policy offices_update on public.offices for update
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());
drop policy if exists offices_delete on public.offices;
create policy offices_delete on public.offices for delete using (public.is_admin());

-- office_members: the office owner and admins manage the roster; a member sees
-- and may remove their own membership.
drop policy if exists office_members_read on public.office_members;
create policy office_members_read on public.office_members for select using (
  user_id = auth.uid()
  or public.is_admin()
  or exists (select 1 from public.offices o where o.id = office_members.office_id and o.owner_id = auth.uid())
);
drop policy if exists office_members_delete on public.office_members;
create policy office_members_delete on public.office_members for delete using (
  user_id = auth.uid()
  or public.is_admin()
  or exists (select 1 from public.offices o where o.id = office_members.office_id and o.owner_id = auth.uid())
);
-- inserts/updates of members are done through the Phase-2 RPCs (definer), not
-- directly from the client, so no insert/update policy is granted here.

-- ================================================= admin: approve an office ==
create or replace function public.review_office(
  target uuid, decision text, note text default ''
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if decision not in ('approved','rejected','suspended','pending') then
    raise exception 'BAD_DECISION' using errcode = 'P0001';
  end if;
  update public.offices
     set status = decision, admin_note = coalesce(review_office.note, ''), updated_at = now()
   where id = target;
  if not found then
    raise exception 'OFFICE_NOT_FOUND' using errcode = 'P0001';
  end if;
end $$;

revoke all on function public.review_office(uuid, text, text) from public, anon;
grant execute on function public.review_office(uuid, text, text) to authenticated;

select count(*) as offices, count(*) filter (where status='pending') as pending from public.offices;
