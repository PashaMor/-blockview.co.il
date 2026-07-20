-- BlockView — require two-factor auth (TOTP) for admin privileges.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- Supabase puts an "aal" (authenticator assurance level) claim in the JWT:
--   aal1 = password only, aal2 = password + verified 2FA code.
-- By requiring aal2 inside is_admin(), admin power is granted ONLY to a session
-- that actually passed 2FA — the UI can't be bypassed by calling the API directly.
--
-- NOTE: agents are NOT forced to aal2 (2FA is optional for them), so is_agent()
-- is intentionally left as-is.

create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
     and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

-- Recovery note: if you ever lock yourself out, the SQL editor bypasses RLS,
-- so you can always fix roles/data from here.
select 'is_admin now requires aal2 (2FA)' as note;
