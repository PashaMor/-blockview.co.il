-- BlockView — agent registration & admin approval.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- Flow: a signed-in user applies from the CRM (agency, license no, phone...).
-- The row lands in 'pending'. Only an admin (is_admin() => role admin + aal2/2FA)
-- can approve it, and approval is the ONLY path that flips profiles.role to
-- 'agent'. Nothing here lets a user grant themselves the agent role.

-- ================================================== applications table ====
create table if not exists public.agent_applications (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null,
  agency      text not null default '',
  license_no  text not null default '',      -- מספר רישיון תיווך (רשם המתווכים)
  phone       text not null,
  city        text not null default '',
  note        text not null default '',      -- free text from the applicant
  status      text not null default 'pending'
              check (status in ('pending','approved','rejected')),
  admin_note  text not null default '',      -- reason shown back to the applicant
  decided_by  uuid references auth.users (id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists agent_apps_status_idx on public.agent_applications (status);

drop trigger if exists agent_apps_touch on public.agent_applications;
create trigger agent_apps_touch before update on public.agent_applications
  for each row execute procedure public.touch_updated_at();

-- ========================================== applicant cannot self-decide ==
-- Same shape as enforce_listing_status: the UI is cosmetic, the DB decides.
-- A non-admin write can only ever produce status='pending' and can never set
-- the decision fields — so nobody can forge an "approved" application.
create or replace function public.enforce_agent_application_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then          -- trusted server context (SQL editor / service role)
    return new;
  end if;
  if public.is_admin() then           -- admins decide (see review_agent_application)
    return new;
  end if;
  new.status     := 'pending';
  new.admin_note := '';
  if tg_op = 'INSERT' then
    new.decided_by := null;
    new.decided_at := null;
  else
    new.decided_by := old.decided_by;
    new.decided_at := old.decided_at;
    new.created_at := old.created_at;
  end if;
  return new;
end; $$;

drop trigger if exists agent_apps_status_guard on public.agent_applications;
create trigger agent_apps_status_guard before insert or update on public.agent_applications
  for each row execute procedure public.enforce_agent_application_status();

-- ====================================================== RLS policies ======
alter table public.agent_applications enable row level security;

drop policy if exists agent_apps_self_insert   on public.agent_applications;
drop policy if exists agent_apps_self_select   on public.agent_applications;
drop policy if exists agent_apps_self_update   on public.agent_applications;
drop policy if exists agent_apps_admin_select  on public.agent_applications;
drop policy if exists agent_apps_admin_update  on public.agent_applications;

-- applicant: sees and writes only their own row (one row per user, PK enforces it)
create policy agent_apps_self_insert on public.agent_applications for insert
  with check (user_id = auth.uid());
create policy agent_apps_self_select on public.agent_applications for select
  using (user_id = auth.uid());
-- may re-submit while pending or after a rejection, never after approval
create policy agent_apps_self_update on public.agent_applications for update
  using (user_id = auth.uid() and status in ('pending','rejected'))
  with check (user_id = auth.uid());

-- admin: full read/write (is_admin() requires 2FA — see 06_2fa.sql)
create policy agent_apps_admin_select on public.agent_applications for select
  using (public.is_admin());
create policy agent_apps_admin_update on public.agent_applications for update
  using (public.is_admin()) with check (public.is_admin());

-- ======================================= admin decision (atomic, guarded) ==
-- Sets the application status AND the role in one transaction, so an approved
-- application can never exist without the role (or the reverse).
create or replace function public.review_agent_application(
  target uuid, decision text, note text default ''
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if decision not in ('approved','rejected') then
    raise exception 'BAD_DECISION' using errcode = 'P0001';
  end if;

  update public.agent_applications
     set status = decision, admin_note = coalesce(note, ''),
         decided_by = auth.uid(), decided_at = now()
   where user_id = target;
  if not found then
    raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- promote on approval; never touch an existing admin, never demote on reject
  if decision = 'approved' then
    update public.profiles set role = 'agent' where id = target and role = 'user';
  end if;
end; $$;

revoke all on function public.review_agent_application(uuid, text, text) from public, anon;
grant execute on function public.review_agent_application(uuid, text, text) to authenticated;

-- quick sanity check
select status, count(*) from public.agent_applications group by status;
