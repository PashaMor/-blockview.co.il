-- BlockView — real-time "waiting for approval" alerts to Telegram.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- This version does NOT use the Supabase "Database Webhooks" feature (its
-- supabase_functions schema may not exist). It calls pg_net directly from a
-- trigger, so it only needs the pg_net extension.
--
-- BEFORE RUNNING — two one-time steps:
--   1. Enable pg_net: Supabase -> Database -> Extensions -> search "pg_net" ->
--      toggle on. (The `create extension` line below also tries, but the UI
--      toggle is the reliable way and sets up the `net` schema.)
--   2. Replace the TWO occurrences of REPLACE_WITH_APPROVAL_WEBHOOK_AUTH below
--      with the real APPROVAL_WEBHOOK_AUTH value (kept in Vercel, never in this
--      repo). Paste it only here in your private SQL editor.
--
-- WHAT IT DOES: when a listing or agent application is written with
-- status = 'pending', the trigger POSTs the row to /api/notify-approval, which
-- posts a short message into the approvals Telegram topic (611). The endpoint
-- verifies the Authorization header and skips rows that were already pending.
--
-- SECURITY VERDICT — SAFE to run.
--   * Adds one SECURITY DEFINER trigger function and two AFTER triggers. No
--     table/column/policy/privilege change, no destructive statement.
--   * search_path is pinned to public; net.http_post is fully qualified.
--   * SECURITY DEFINER is REQUIRED here: the trigger fires in the context of the
--     user inserting a listing, who has no rights on net.http_post; running as
--     the function owner lets the call succeed without granting users pg_net.
--   * The whole call is wrapped in EXCEPTION WHEN OTHERS -> the notification can
--     NEVER fail or roll back the user's insert. pg_net is async anyway, so a
--     slow/at-fault webhook never blocks the write.
--   * The WHEN clause fires only for rows whose status IS 'pending' (never on
--     approve/reject). The secret lives only in this function body (visible to
--     admins/service_role, never to anon/authenticated or the browser).

create extension if not exists pg_net;

create or replace function public.notify_approval_pending()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform net.http_post(
      url     := 'https://blockview.co.il/api/notify-approval',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer REPLACE_WITH_APPROVAL_WEBHOOK_AUTH'
      ),
      body    := jsonb_build_object(
        'type',       tg_op,
        'table',      tg_table_name,
        'record',     to_jsonb(new),
        'old_record', case when tg_op = 'UPDATE' then to_jsonb(old) else null end
      )
    );
  exception when others then
    -- a notification problem must never break the user's insert/update
    null;
  end;
  return new;
end;
$$;

drop trigger if exists notify_listing_pending on public.listings;
create trigger notify_listing_pending
after insert or update on public.listings
for each row
when (new.status = 'pending')
execute function public.notify_approval_pending();

drop trigger if exists notify_agent_app_pending on public.agent_applications;
create trigger notify_agent_app_pending
after insert or update on public.agent_applications
for each row
when (new.status = 'pending')
execute function public.notify_approval_pending();

select 'approval notifications wired via pg_net: listings + agent_applications -> /api/notify-approval' as note;
