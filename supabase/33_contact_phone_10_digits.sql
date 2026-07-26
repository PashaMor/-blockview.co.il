-- BlockView — a listing contact's phone must be exactly 10 digits.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- Israeli numbers are 10 digits (05X-XXXXXXX). The publish/CRM forms already
-- enforce this, but a form is cosmetic — anyone can call the API directly — so
-- the real rule lives here. Formatting (dashes, spaces) is allowed in the stored
-- value; the check counts DIGITS only.
--
-- NOT VALID: applies to every insert/update from now on, but does not re-check
-- rows written earlier, so nothing existing breaks. Fix any offenders with the
-- query at the bottom, then optionally VALIDATE.
--
-- SECURITY VERDICT — safe. One CHECK constraint, no policy/privilege change, no
-- DDL beyond the constraint, no dynamic SQL.

do $$ begin
  alter table public.listing_contacts add constraint listing_contacts_phone_10_chk
    check (length(regexp_replace(phone, '\D', '', 'g')) = 10) not valid;
exception when duplicate_object then null; end $$;

-- existing contacts that would fail the new rule (fix or delete these, then you
-- may run: alter table public.listing_contacts validate constraint listing_contacts_phone_10_chk;)
select listing_id, name, phone,
       length(regexp_replace(phone, '\D', '', 'g')) as digits
from   public.listing_contacts
where  length(regexp_replace(phone, '\D', '', 'g')) <> 10
order  by digits;
