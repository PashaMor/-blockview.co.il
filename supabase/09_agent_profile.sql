-- BlockView — agent identity & branding (first/last name, firm, licence, logo).
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
-- Requires 07_agent_applications.sql.
--
-- Why a separate table: the logo and firm name must be readable by ANY visitor so
-- they can be shown on the agent's listings. public.profiles holds private data
-- (email, plan, consent), and RLS is row-level, not column-level — making profiles
-- publicly readable would leak all of it. agent_profiles carries only branding.

-- ============================== extra fields on the application form ======
alter table public.agent_applications add column if not exists first_name text not null default '';
alter table public.agent_applications add column if not exists last_name  text not null default '';
alter table public.agent_applications add column if not exists logo_path  text;

-- backfill first/last from the single full_name of any existing application
update public.agent_applications
set    first_name = split_part(full_name, ' ', 1),
       last_name  = nullif(substr(full_name, strpos(full_name, ' ') + 1), full_name)
where  first_name = '' and full_name <> '';
update public.agent_applications set last_name = '' where last_name is null;

-- ===================================================== public branding ====
create table if not exists public.agent_profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  first_name text not null,
  last_name  text not null default '',
  agency     text not null default '',
  license_no text not null default '',
  logo_path  text,                       -- object path in the agent-logos bucket
  phone      text,                       -- shown on the agent's own listings
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists agent_profiles_touch on public.agent_profiles;
create trigger agent_profiles_touch before update on public.agent_profiles
  for each row execute procedure public.touch_updated_at();

alter table public.agent_profiles enable row level security;

drop policy if exists agent_profiles_read   on public.agent_profiles;
drop policy if exists agent_profiles_insert on public.agent_profiles;
drop policy if exists agent_profiles_update on public.agent_profiles;
drop policy if exists agent_profiles_delete on public.agent_profiles;

-- branding is public (it is printed on listings)
create policy agent_profiles_read on public.agent_profiles for select using (true);
-- only an approved agent may create/maintain their own row; admins may fix any
create policy agent_profiles_insert on public.agent_profiles for insert
  with check ((user_id = auth.uid() and public.is_agent()) or public.is_admin());
create policy agent_profiles_update on public.agent_profiles for update
  using ((user_id = auth.uid() and public.is_agent()) or public.is_admin())
  with check ((user_id = auth.uid() and public.is_agent()) or public.is_admin());
create policy agent_profiles_delete on public.agent_profiles for delete
  using (public.is_admin());

-- ============================================== approval seeds branding ===
-- Approving an application now also publishes the agent's branding, in the same
-- transaction as the role change. is_admin() still requires role admin + aal2.
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

  update public.agent_applications
     set status = decision, admin_note = coalesce(note, ''),
         decided_by = auth.uid(), decided_at = now()
   where user_id = target
  returning * into app;
  if not found then
    raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0001';
  end if;

  if decision = 'approved' then
    -- promote; never touch an existing admin, never demote on reject
    update public.profiles set role = 'agent' where id = target and role = 'user';

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

-- ================================================ storage for the logos ===
insert into storage.buckets (id, name, public)
values ('agent-logos', 'agent-logos', true)
on conflict (id) do nothing;

-- public read (logos appear on listings); each user writes only inside a folder
-- named after their own uid — the same rule as listing photos
drop policy if exists "agent logos read"   on storage.objects;
drop policy if exists "agent logos insert" on storage.objects;
drop policy if exists "agent logos update" on storage.objects;
drop policy if exists "agent logos delete" on storage.objects;
create policy "agent logos read" on storage.objects for select
  using (bucket_id = 'agent-logos');
create policy "agent logos insert" on storage.objects for insert
  with check (bucket_id = 'agent-logos' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "agent logos update" on storage.objects for update
  using (bucket_id = 'agent-logos' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "agent logos delete" on storage.objects for delete
  using (bucket_id = 'agent-logos' and auth.uid()::text = (storage.foldername(name))[1]);

select count(*) as agent_profiles from public.agent_profiles;
