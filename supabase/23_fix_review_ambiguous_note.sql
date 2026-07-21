-- BlockView — fix "column reference \"note\" is ambiguous" when approving an agent.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
-- Replaces review_agent_application() from 09_agent_profile.sql.
--
-- The function takes a parameter called `note`, and agent_applications also has
-- a column called `note` (the applicant's free text). In the UPDATE below, a
-- bare `note` could mean either, so PostgreSQL refuses the whole statement and
-- approving an agent failed with:
--     column reference "note" is ambiguous
--
-- The parameter is now qualified with the function name — review_agent_application.note
-- — which is unambiguous. The signature is unchanged, so the client keeps
-- calling it with the same argument names and no grant has to be redone.

create or replace function public.review_agent_application(
  target uuid, decision text, note text default ''
) returns void
language plpgsql security definer set search_path = public as $$
declare
  app public.agent_applications%rowtype;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if decision not in ('approved','rejected') then
    raise exception 'BAD_DECISION' using errcode = 'P0001';
  end if;

  update public.agent_applications a
     set status     = decision,
         admin_note = coalesce(review_agent_application.note, ''),   -- the PARAMETER
         decided_by = auth.uid(),
         decided_at = now()
   where a.user_id = target
  returning a.* into app;

  if not found then
    raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0001';
  end if;

  if decision = 'approved' then
    -- promote; never touch an existing admin, never demote on reject
    update public.profiles set role = 'agent' where id = target and role = 'user';

    -- publish the branding that listings will show
    insert into public.agent_profiles (user_id, first_name, last_name, agency, license_no, logo_path, phone)
    values (target, app.first_name, app.last_name, app.agency, app.license_no, app.logo_path, app.phone)
    on conflict (user_id) do update
      set first_name = excluded.first_name,
          last_name  = excluded.last_name,
          agency     = excluded.agency,
          license_no = excluded.license_no,
          logo_path  = coalesce(excluded.logo_path, public.agent_profiles.logo_path),
          phone      = excluded.phone;
  end if;
end; $$;

revoke all on function public.review_agent_application(uuid, text, text) from public, anon;
grant execute on function public.review_agent_application(uuid, text, text) to authenticated;

select 'review_agent_application fixed — approving an agent works now' as note;
