-- BlockView — let an admin confirm a user's email without the verification link.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- Useful when mail is slow, bounces, or the address is on a domain that refuses
-- our sender. It is a deliberate override of a security step, so it is limited
-- to an admin who has passed 2FA, exactly like every other privileged action.
--
-- auth.users.confirmed_at is a generated column in current Supabase, so only
-- email_confirmed_at is written here.

-- ============================================ who is confirmed, and when ==
-- profiles cannot hold this: it lives in auth.users, which the browser cannot
-- read. This returns the minimum the console needs to show the state.
create or replace function public.admin_auth_status()
returns table (user_id uuid, email_confirmed_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return query
    select u.id, u.email_confirmed_at, u.last_sign_in_at
    from   auth.users u;
end; $$;

revoke all on function public.admin_auth_status() from public, anon;
grant execute on function public.admin_auth_status() to authenticated;

-- ==================================================== confirm by an admin ==
create or replace function public.admin_confirm_email(target uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
declare
  already timestamptz;
begin
  if not public.is_admin() then                 -- role admin AND aal2 (2FA)
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select email_confirmed_at into already from auth.users where id = target;
  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if already is not null then
    return;                                     -- already confirmed, nothing to do
  end if;

  update auth.users
  set    email_confirmed_at = now(),
         updated_at = now()
  where  id = target;
end; $$;

revoke all on function public.admin_confirm_email(uuid) from public, anon;
grant execute on function public.admin_confirm_email(uuid) to authenticated;

select count(*) filter (where email_confirmed_at is not null) as confirmed,
       count(*) filter (where email_confirmed_at is null)     as unconfirmed
from   auth.users;
