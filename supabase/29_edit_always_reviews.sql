-- BlockView — a content edit to a live listing ALWAYS goes back to review.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
-- Replaces track_listing_changes() from 26_listing_revisions.sql.
--
-- The old version exempted admins ("and not admin"), on the theory that an
-- admin editing a listing was moderating it. But moderation is status-only —
-- the admin console just flips `status` — so it never trips the content diff
-- anyway. The exemption's only real effect was that an admin editing their OWN
-- listing (as an owner) left it live on the map with changed text. Since most
-- test accounts are admins, it also looked like the re-review rule was broken.
--
-- Now: any content change to an approved listing sends it back to 'pending',
-- whoever makes it. A status-only change (the admin approving or rejecting)
-- changes no tracked field, so material stays false and nothing bounces.

create or replace function public.track_listing_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  fields text[] := array[
    'title','description','price','rooms','size','floor','floors_total',
    'type','category','deal','age','furnished','pets','parking','elevator',
    'tour_url','website_url','building_id'
  ];
  f        text;
  o        jsonb := to_jsonb(old);
  n        jsonb := to_jsonb(new);
  diff     jsonb := '{}'::jsonb;
  material boolean := false;
  admin    boolean := coalesce(public.is_admin(), false);
begin
  foreach f in array fields loop
    if (o -> f) is distinct from (n -> f) then
      diff := diff || jsonb_build_object(f, jsonb_build_object('from', o -> f, 'to', n -> f));
      material := true;
    end if;
  end loop;

  -- a live listing whose content changed has to be looked at again — no matter
  -- who edited it. The SQL editor / service role (auth.uid() is null) is exempt,
  -- so the seed and import scripts don't bounce everything they touch.
  if material and old.status = 'approved' and new.status = 'approved'
     and auth.uid() is not null then
    new.status := 'pending';
  end if;

  if material or (new.status is distinct from old.status) then
    insert into public.listing_revisions
      (listing_id, changed_by, by_admin, changes, status_before, status_after)
    values (new.id, auth.uid(), admin, diff, old.status, new.status);
  end if;

  return new;
end; $$;

drop trigger if exists listings_track_changes on public.listings;
create trigger listings_track_changes before update on public.listings
  for each row execute procedure public.track_listing_changes();

select 'edits to a live listing now always go back to review' as note;
