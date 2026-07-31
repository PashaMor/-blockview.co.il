-- BlockView — relax a listing contact's phone to 8–10 digits (was exactly 10).
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- Why: Israeli LANDLINES are 9 digits (e.g. 09-8616716 in Netanya, 03-XXXXXXX in
-- Tel Aviv), while mobiles/VoIP are 10 (05X / 07X). The old rule in
-- 33_contact_phone_10_digits.sql demanded exactly 10 digits and silently rejected
-- every landline. Agents/owners posting an office landline could not be saved.
--
-- IMPORTANT: 33's constraint was added with `exception when duplicate_object then
-- null`, so simply re-running an edited 33 does NOT change it — a same-named
-- ADD CONSTRAINT throws duplicate_object and is swallowed. We must DROP the old
-- constraint by name, then ADD the new range. That is exactly what this does.
--
-- NOT VALID: the new rule applies to every insert/update from now on but does not
-- re-check older rows, so nothing existing breaks.
--
-- SECURITY VERDICT — SAFE to run. It only swaps one CHECK constraint on
-- listing_contacts (drops the =10 rule, adds an 8..10 range). No SECURITY DEFINER,
-- no policy/RLS change, no privilege grant, no dynamic SQL, no destructive DML.
-- It loosens an input-validation bound only; RLS still governs who may write the row.

alter table public.listing_contacts
  drop constraint if exists listing_contacts_phone_10_chk;

do $$ begin
  alter table public.listing_contacts add constraint listing_contacts_phone_8_10_chk
    check (length(regexp_replace(phone, '\D', '', 'g')) between 8 and 10) not valid;
exception when duplicate_object then null; end $$;

-- contacts that would still fail the new rule (fewer than 8 / more than 10 digits):
select listing_id, name, phone,
       length(regexp_replace(phone, '\D', '', 'g')) as digits
from   public.listing_contacts
where  length(regexp_replace(phone, '\D', '', 'g')) not between 8 and 10
order  by digits;
