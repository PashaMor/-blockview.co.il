-- BlockView — RevenueCat subscription sync.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
-- Requires 02_crm.sql (protect_profile_fields) + schema.sql (profiles.plan).
--
-- RevenueCat is the source of truth for who is subscribed to Pro. Its webhook
-- POSTs to /api/revenuecat-webhook, which uses the SUPABASE_SECRET_KEY
-- (service_role, auth.uid() = null) to set profiles.plan to 'pro'/'free'. That
-- path is allowed by protect_profile_fields because auth.uid() is null there.
--
-- This migration just adds informational tracking columns and — importantly —
-- extends protect_profile_fields so a normal user can't spoof them either.
--
-- SECURITY VERDICT — SAFE. Additive columns only, no RLS/policy/privilege
-- change, no destructive op, no dynamic SQL. It TIGHTENS security: the three new
-- columns join role/plan as fields a non-admin user cannot self-edit (the DB, not
-- the client, is the gate). The real Pro gate remains profiles.plan, which users
-- already cannot change. search_path is pinned on the SECURITY DEFINER trigger.

alter table public.profiles
  add column if not exists plan_source     text,          -- 'revenuecat' | 'admin' | null
  add column if not exists plan_expires_at timestamptz,   -- when the current entitlement lapses
  add column if not exists rc_customer_id  text;          -- RevenueCat app_user_id (= profiles.id)

-- Extend the self-edit guard: role, plan, and now the plan_* / rc_* fields can
-- only be changed by an admin or by a server call with no user JWT (auth.uid()
-- null = the service_role webhook). Same shape as before, more fields covered.
create or replace function public.protect_profile_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.role            is distinct from old.role)
     or (new.plan            is distinct from old.plan)
     or (new.plan_source     is distinct from old.plan_source)
     or (new.plan_expires_at is distinct from old.plan_expires_at)
     or (new.rc_customer_id  is distinct from old.rc_customer_id) then
    if auth.uid() is not null
       and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') then
      raise exception 'FORBIDDEN_FIELD_CHANGE' using errcode = 'P0001';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect before update on public.profiles
  for each row execute procedure public.protect_profile_fields();

select 'revenuecat: profiles.plan_source/plan_expires_at/rc_customer_id ready' as note;
