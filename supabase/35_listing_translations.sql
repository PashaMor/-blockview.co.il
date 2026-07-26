-- BlockView — store each listing's title & description in every app language.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
-- Requires pg_net (already enabled by 32_lead_notify.sql).
--
-- Listings are written in one language; the UI is in six. This table holds the
-- translated title/description per language, filled once by /api/translate-listing
-- and read by the app. A trigger POSTs to that endpoint whenever a listing is
-- created or its text changes, so translations stay current with no per-view cost.
--
-- SECURITY VERDICT — safe. RLS: a translation is readable exactly when its
-- listing is (approved, own, or admin), so pending text never leaks. No client
-- write policy — only the service key (via the endpoint) writes here. The trigger
-- is a plain AFTER trigger that hands the endpoint a listing id and nothing else;
-- it can never block or fail the listing write.

create table if not exists public.listing_translations (
  listing_id  uuid not null references public.listings (id) on delete cascade,
  lang        text not null check (lang in ('he','en','es','ar','fr','ru')),
  title       text,
  description text,
  updated_at  timestamptz not null default now(),
  primary key (listing_id, lang)
);

alter table public.listing_translations enable row level security;

drop policy if exists listing_translations_read on public.listing_translations;
create policy listing_translations_read on public.listing_translations for select using (
  exists (select 1 from public.listings l
          where l.id = listing_id
            and (l.status = 'approved' or l.agent_id = auth.uid() or public.is_admin()))
);
-- no insert/update/delete policy: only the service role (the endpoint) writes.

-- ============================================ fire translation on change ==
create or replace function public.request_listing_translation()
returns trigger language plpgsql as $$
begin
  -- only when there is text and, on update, when the text actually changed
  if tg_op = 'UPDATE'
     and new.title is not distinct from old.title
     and new.description is not distinct from old.description then
    return new;
  end if;
  perform net.http_post(
    url     := 'https://blockview.co.il/api/translate-listing',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object('id', new.id)
  );
  return new;
exception when others then
  return new;                       -- a translation hiccup must never block the write
end $$;

drop trigger if exists listings_translate on public.listings;
create trigger listings_translate after insert or update of title, description on public.listings
  for each row execute procedure public.request_listing_translation();

-- ============================== one-time: translate everything already live ==
-- Stale translations self-refresh on the next edit; this seeds what exists now.
do $$
declare r record;
begin
  for r in select id from public.listings where status = 'approved' loop
    perform net.http_post(
      url     := 'https://blockview.co.il/api/translate-listing',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := jsonb_build_object('id', r.id));
  end loop;
end $$;

select count(*) as translations_stored from public.listing_translations;
