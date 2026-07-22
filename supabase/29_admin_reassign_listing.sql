-- BlockView — let an admin hand a listing over to an agent.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- The onboarding flow: an admin creates listings from the data an agent gives
-- them, shows the agent their properties already live on the map, and once the
-- agent signs up the admin moves those listings onto the agent's account so the
-- agent manages them from the CRM.
--
-- Reassigning changes only listings.agent_id. Photos, contacts, enquiries and
-- the building all reference the listing, not the agent, so they travel with it
-- untouched. poster_type is set to 'agent' since it now belongs to one.
--
-- SECURITY: admin-only, and is_admin() already requires aal2 (2FA), so a stolen
-- password cannot move listings around. The target must be a real agent, so a
-- listing can't be parked on an arbitrary or non-existent account. RLS on
-- listings is unaffected — this runs as definer precisely so an admin can set
-- an agent_id that is not their own uid, which the normal policy forbids.

create or replace function public.admin_reassign_listing(
  p_listing uuid,
  p_agent   uuid
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- the destination must be an approved agent (or an admin), never a plain user
  if not exists (
    select 1 from public.profiles
    where id = p_agent and role in ('agent', 'admin')
  ) then
    raise exception 'TARGET_NOT_AGENT' using errcode = 'P0001';
  end if;

  update public.listings
     set agent_id    = p_agent,
         poster_type = 'agent'
   where id = p_listing;

  if not found then
    raise exception 'LISTING_NOT_FOUND' using errcode = 'P0001';
  end if;
end; $$;

revoke all on function public.admin_reassign_listing(uuid, uuid) from public, anon;
grant execute on function public.admin_reassign_listing(uuid, uuid) to authenticated;

select 'admin_reassign_listing ready — admins can move a listing to an agent' as note;
