-- BlockView — real-time "waiting for approval" alerts to Telegram.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- PREREQUISITE: Database Webhooks must be enabled once so the helper
-- `supabase_functions.http_request` (and pg_net) exist. In the Supabase
-- dashboard: Integrations -> Database Webhooks -> Enable (or Database ->
-- Webhooks). If this script errors with
--   function supabase_functions.http_request(...) does not exist
-- then webhooks aren't enabled yet — enable them and re-run.
--
-- BEFORE RUNNING: replace the two occurrences of REPLACE_WITH_APPROVAL_WEBHOOK_AUTH
-- below with the real APPROVAL_WEBHOOK_AUTH value (kept in Vercel and never in
-- this repo). The secret is deliberately NOT committed — paste it only here in
-- your private Supabase SQL editor.
--
-- WHAT IT DOES: when a listing or an agent application is written with
-- status = 'pending', Supabase POSTs the row to /api/notify-approval, which
-- posts a short message into the approvals Telegram topic (611). The endpoint
-- verifies the Authorization header set below, and itself skips rows that were
-- already pending (so editing a pending row doesn't re-alert).
--
-- SECURITY VERDICT — SAFE to run.
--   * Adds two AFTER INSERT/UPDATE triggers only. No table, column, policy, or
--     privilege change; no destructive statement; no SECURITY DEFINER function
--     of ours.
--   * Triggers fire asynchronously via pg_net, so a slow or failing webhook can
--     never block or roll back the user's insert.
--   * The WHEN clause fires only for rows whose status IS 'pending', so approve
--     / reject and unrelated edits never call out.
--   * The shared secret in the header is readable only by roles that can see
--     trigger definitions (admins / service_role) — never anon/authenticated or
--     the browser. To rotate it: change the value in Vercel
--     (APPROVAL_WEBHOOK_AUTH) and re-run this file with the new value.

drop trigger if exists notify_listing_pending on public.listings;
create trigger notify_listing_pending
after insert or update on public.listings
for each row
when (new.status = 'pending')
execute function supabase_functions.http_request(
  'https://blockview.co.il/api/notify-approval',
  'POST',
  '{"Content-Type":"application/json","Authorization":"Bearer REPLACE_WITH_APPROVAL_WEBHOOK_AUTH"}',
  '{}',
  '5000'
);

drop trigger if exists notify_agent_app_pending on public.agent_applications;
create trigger notify_agent_app_pending
after insert or update on public.agent_applications
for each row
when (new.status = 'pending')
execute function supabase_functions.http_request(
  'https://blockview.co.il/api/notify-approval',
  'POST',
  '{"Content-Type":"application/json","Authorization":"Bearer REPLACE_WITH_APPROVAL_WEBHOOK_AUTH"}',
  '{}',
  '5000'
);

select 'approval notifications wired: listings + agent_applications -> /api/notify-approval' as note;
