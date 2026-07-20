-- BlockView — let an agent delete an enquiry from their own inbox.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- leads had insert/select/update policies but no delete one, so nothing could be
-- removed from the client. Scope is the same as reading: your own leads only.

drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads for delete
  using (agent_id = auth.uid() or public.is_admin());

select 'leads: owning agent (or admin) may delete' as note;
