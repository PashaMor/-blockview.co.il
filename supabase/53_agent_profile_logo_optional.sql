-- BlockView — the agent-profile logo is now OPTIONAL.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- Why: an admin can add an agent manually (no application form, so no logo). The
-- old required-fields check demanded a logo, which blocked the admin from saving
-- even the name/agency/licence with the error
--   'new row for relation "agent_profiles" violates check "agent_profiles_required_chk"'.
-- Name / agency / licence stay required; the logo is optional (listings and the
-- public profile already fall back to no logo when it is absent).
--
-- SECURITY VERDICT — safe to run. It only RELAXES a CHECK constraint (drops the
-- logo requirement). No policy, privilege, trigger or RLS change; no dynamic SQL.

alter table public.agent_profiles drop constraint if exists agent_profiles_required_chk;
alter table public.agent_profiles add constraint agent_profiles_required_chk check (
      btrim(first_name) <> ''
  and btrim(last_name)  <> ''
  and btrim(agency)     <> ''
  and btrim(license_no) <> ''
) not valid;

select 'agent_profiles: logo is now optional' as note;
