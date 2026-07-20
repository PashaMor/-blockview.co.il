-- BlockView — make the agent sign-up fields mandatory in the DATABASE.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
-- Requires 07_agent_applications.sql and 09_agent_profile.sql.
--
-- The CRM form already marks them required, but a form is cosmetic: anyone can
-- call the API directly. These constraints mean an application row cannot exist
-- without a first name, last name, firm, licence number, phone and logo.
--
-- NOT VALID: the checks apply to every INSERT and UPDATE from now on, but do not
-- re-check rows written before this migration, so nothing existing breaks.

-- ============================================ agent_applications ==========
do $$ begin
  alter table public.agent_applications add constraint agent_apps_required_chk check (
    btrim(first_name) <> ''
    and btrim(last_name)  <> ''
    and btrim(agency)     <> ''
    and btrim(license_no) <> ''
    and btrim(phone)      <> ''
    and logo_path is not null and btrim(logo_path) <> ''
  ) not valid;
exception when duplicate_object then null; end $$;

-- =============================================== agent_profiles ===========
-- The branding row is written by review_agent_application() from the application,
-- so it inherits valid values; this keeps it true if it is edited later.
do $$ begin
  alter table public.agent_profiles add constraint agent_profiles_required_chk check (
    btrim(first_name) <> ''
    and btrim(last_name)  <> ''
    and btrim(agency)     <> ''
    and btrim(license_no) <> ''
    and logo_path is not null and btrim(logo_path) <> ''
  ) not valid;
exception when duplicate_object then null; end $$;

-- Which existing rows would fail the new rule (informational — they still work,
-- but the next edit will have to fill the missing fields):
select user_id, status,
       btrim(first_name) = '' as no_first_name,
       btrim(last_name)  = '' as no_last_name,
       btrim(agency)     = '' as no_agency,
       btrim(license_no) = '' as no_license,
       btrim(phone)      = '' as no_phone,
       logo_path is null      as no_logo
from   public.agent_applications
where  btrim(first_name) = '' or btrim(last_name) = '' or btrim(agency) = ''
   or  btrim(license_no) = '' or btrim(phone) = '' or logo_path is null;
