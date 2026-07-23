-- BlockView — notify the moment a new enquiry (lead) is created.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- A lead used to sit in the CRM until an agent happened to log in. Now a
-- trigger POSTs to /api/notify-lead the instant a lead is inserted, which sends
-- a Telegram message to the team and (if configured) an email to the agent.
--
-- Uses pg_net (bundled with Supabase) to fire the HTTP call asynchronously, so
-- the enquiry insert itself is never slowed or blocked by the notification.
--
-- SECURITY: the endpoint acts only on a real lead id and marks notified_at, so
-- it is idempotent and needs no shared secret in this file (a secret here would
-- live in the repo, which is worse). Lead ids are unguessable UUIDs. The
-- trigger is a plain AFTER INSERT trigger; no SECURITY DEFINER, no data exposed
-- beyond the lead id that pg_net sends to our own endpoint.

create extension if not exists pg_net with schema extensions;

-- remember that a lead was announced, so it never fires twice
alter table public.leads add column if not exists notified_at timestamptz;

create or replace function public.notify_new_lead()
returns trigger language plpgsql as $$
begin
  -- fire-and-forget POST; pg_net queues it and returns immediately
  perform net.http_post(
    url     := 'https://blockview.co.il/api/notify-lead',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object('id', new.id)
  );
  return new;
exception when others then
  -- a notification failure must never break the enquiry itself
  return new;
end $$;

drop trigger if exists leads_notify on public.leads;
create trigger leads_notify after insert on public.leads
  for each row execute procedure public.notify_new_lead();

select 'lead notifications wired — new enquiries POST to /api/notify-lead' as note;
