-- BlockView — record whether the person who sent an enquiry agreed to have it
-- passed on to paying partners (brokers, mortgage providers).
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- The privacy policy now promises three things. This migration is what makes
-- them true rather than decorative:
--   1. sharing happens ONLY on an explicit, separately-ticked opt-in
--      -> share_consent, default false;
--   2. it is NOT retroactive — every lead collected before today was gathered
--      under "we do not pass your details to third parties", so it must stay
--      unshareable -> the default backfills every existing row to false;
--   3. we can prove when consent was given -> share_consent_at, stamped by the
--      database, never by the client.

alter table public.leads add column if not exists share_consent    boolean not null default false;
alter table public.leads add column if not exists share_consent_at timestamptz;

comment on column public.leads.share_consent is
  'Opt-in to pass this enquiry to paying business partners. False = advertiser only.';

-- ===================================================== stamp the timestamp ==
-- The client sends the boolean; the time is ours. A caller cannot claim consent
-- was given at some other moment, and cannot quietly flip an old lead to
-- "consented" without the timestamp moving with it.
create or replace function public.stamp_share_consent()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.share_consent then
    if tg_op = 'INSERT' or not coalesce(old.share_consent, false) then
      new.share_consent_at := now();
    end if;
  else
    new.share_consent_at := null;          -- consent withdrawn / never given
  end if;
  return new;
end $$;

drop trigger if exists trg_stamp_share_consent on public.leads;
create trigger trg_stamp_share_consent
  before insert or update on public.leads
  for each row execute procedure public.stamp_share_consent();

-- Existing rows: collected under the old policy, so they stay false/null.
select count(*) filter (where share_consent)     as consented,
       count(*) filter (where not share_consent) as advertiser_only
from   public.leads;
