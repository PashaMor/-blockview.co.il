-- BlockView — allow property OWNERS (not just agents) to publish a listing.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.

-- who posted it: a private owner, or a realtor via the CRM
alter table public.listings add column if not exists poster_type text not null default 'owner';
do $$ begin
  alter table public.listings add constraint listings_poster_type_chk
    check (poster_type in ('owner','agent'));
exception when duplicate_object then null; end $$;

-- Any signed-in user may publish a listing they own.
-- (Was: agents only. Owners now post from the website.)
drop policy if exists listings_insert on public.listings;
create policy listings_insert on public.listings for insert
  with check (agent_id = auth.uid());

-- SECURITY: nobody can publish/approve their own listing to the public map.
-- Only an admin may set status='approved'; everyone else lands in 'pending'.
create or replace function public.enforce_listing_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'approved' and not public.is_admin() then
      new.status := 'pending';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.status is distinct from old.status
       and new.status = 'approved' and not public.is_admin() then
      new.status := old.status;      -- silently refuse self-approval
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists listings_status_guard on public.listings;
create trigger listings_status_guard before insert or update on public.listings
  for each row execute procedure public.enforce_listing_status();
