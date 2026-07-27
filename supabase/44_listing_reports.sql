-- BlockView — let anyone report a problem with a listing.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- A report is delivered to two places by RLS, not by email: the listing's own
-- agent (their CRM) and any admin (the console). It mirrors the leads design —
-- the agent is derived from the listing by a trigger so it can't be aimed at
-- someone else, and inserts are validated + rate-limited because a report is
-- publicly writable.
--
-- SECURITY VERDICT — safe.
--   * listing_reports has RLS ON. INSERT is allowed only on an APPROVED listing.
--     A trigger overwrites agent_id (from the listing) and reporter_id (from
--     auth.uid()), so neither can be spoofed by the client.
--   * READ / UPDATE only for the owning agent or an admin — nobody else sees
--     reports. No delete policy (kept for the record; admins can purge via SQL).
--   * limit_listing_reports() is SECURITY DEFINER, search_path pinned, no dynamic
--     SQL; it only counts recent rows.

-- ============================================================ table =======
create table if not exists public.listing_reports (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references public.listings (id) on delete cascade,
  agent_id    uuid,                       -- set by trigger from the listing
  reporter_id uuid,                       -- set by trigger from auth.uid() (null if guest)
  reason      text not null check (reason in
                ('unavailable','wrong_price','wrong_details','misleading_photos','scam','offensive','other')),
  details     text check (details is null or length(details) <= 1000),
  status      text not null default 'new' check (status in ('new','reviewed','dismissed','actioned')),
  created_at  timestamptz not null default now()
);
create index if not exists listing_reports_agent_idx   on public.listing_reports (agent_id, created_at desc);
create index if not exists listing_reports_listing_idx on public.listing_reports (listing_id, created_at desc);

-- ==================================== derive agent + reporter (no spoofing) ==
create or replace function public.set_report_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select l.agent_id into new.agent_id from public.listings l where l.id = new.listing_id;
  if new.agent_id is null then raise exception 'LISTING_NOT_FOUND'; end if;
  new.reporter_id := auth.uid();     -- trust the session, not the client
  new.status := 'new';
  return new;
end; $$;
drop trigger if exists listing_reports_set_owner on public.listing_reports;
create trigger listing_reports_set_owner before insert on public.listing_reports
  for each row execute procedure public.set_report_owner();

-- ========================================================== rate limit ====
create or replace function public.limit_listing_reports()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  -- per listing: a flood of reports on one listing is the abuse to stop
  select count(*) into n from public.listing_reports
   where listing_id = new.listing_id and created_at > now() - interval '1 hour';
  if n >= 10 then raise exception 'TOO_MANY_REPORTS' using errcode = 'P0001'; end if;
  -- a signed-in reporter can't spam many listings either
  if auth.uid() is not null then
    select count(*) into n from public.listing_reports
     where reporter_id = auth.uid() and created_at > now() - interval '1 hour';
    if n >= 20 then raise exception 'TOO_MANY_REPORTS' using errcode = 'P0001'; end if;
  end if;
  return new;
end; $$;
drop trigger if exists listing_reports_rate on public.listing_reports;
create trigger listing_reports_rate before insert on public.listing_reports
  for each row execute procedure public.limit_listing_reports();

-- =============================================================== RLS ======
alter table public.listing_reports enable row level security;

-- INSERT: anyone (incl. a guest) may report, but ONLY an approved listing.
drop policy if exists listing_reports_insert on public.listing_reports;
create policy listing_reports_insert on public.listing_reports for insert with check (
  exists (select 1 from public.listings l where l.id = listing_id and l.status = 'approved')
);

-- READ: the owning agent (CRM) and admins (console). Delivered here, not by email.
drop policy if exists listing_reports_read on public.listing_reports;
create policy listing_reports_read on public.listing_reports for select using (
  agent_id = auth.uid() or public.is_admin()
);

-- UPDATE: the agent or an admin may move a report along (reviewed/dismissed/…).
drop policy if exists listing_reports_update on public.listing_reports;
create policy listing_reports_update on public.listing_reports for update
  using (agent_id = auth.uid() or public.is_admin())
  with check (agent_id = auth.uid() or public.is_admin());

select 'listing_reports ready — reports reach the agent CRM and the admin console' as note;
