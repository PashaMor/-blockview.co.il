-- BlockView — cap a listing price at ₪99,000,000.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- A typo like 1,513,054,825 breaks the price filter's scale and looks broken on
-- the card. The forms now cap the input, but a form is cosmetic — this is the
-- part that actually holds, for the API too.
--
-- NOT VALID: applies to every insert/update from now on, but does not re-check
-- rows written earlier, so nothing existing starts failing. Fix any offenders
-- with the query at the bottom, then optionally VALIDATE.

do $$ begin
  alter table public.listings add constraint listings_price_max_chk
    check (price <= 99000000) not valid;
exception when duplicate_object then null; end $$;

-- rows that would fail the new rule (fix these by hand in the admin console)
select id, title, price, status
from   public.listings
where  price > 99000000
order  by price desc;
