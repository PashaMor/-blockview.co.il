-- BlockView — buyer enquiries ("leads") sent from the public listing card.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- `leads` is the only table an ANONYMOUS visitor may write to, so it is the main
-- abuse surface on the site. This migration adds the missing input validation and
-- a rate limit, both server-side — the form cannot be trusted.

-- optional email on an enquiry (phone stays the primary channel)
alter table public.leads add column if not exists email text;

-- ------------------------------------------------------------ validation ---
-- length/format bounds so nobody can post an essay or junk through the API
do $$ begin
  alter table public.leads add constraint leads_name_chk
    check (length(btrim(name)) between 2 and 80);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.leads add constraint leads_phone_chk
    check (phone is null or length(btrim(phone)) between 6 and 20);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.leads add constraint leads_message_chk
    check (message is null or length(message) <= 1000);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.leads add constraint leads_email_chk
    check (email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');
exception when duplicate_object then null; end $$;

-- an enquiry with no way to answer it is worthless
do $$ begin
  alter table public.leads add constraint leads_reachable_chk
    check (phone is not null or email is not null);
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------ rate limit ---
-- Caps how fast enquiries can land on one listing. Not a CAPTCHA, but it turns a
-- flood into a trickle, and the agent's inbox stays usable.
create or replace function public.limit_leads()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(*) into n
  from   public.leads
  where  listing_id = new.listing_id
    and  created_at > now() - interval '1 hour';
  if n >= 20 then
    raise exception 'TOO_MANY_LEADS' using errcode = 'P0001';
  end if;
  return new;
end; $$;

drop trigger if exists leads_rate_limit on public.leads;
create trigger leads_rate_limit before insert on public.leads
  for each row execute procedure public.limit_leads();

create index if not exists leads_listing_time_idx on public.leads (listing_id, created_at desc);

-- Note on the existing policies (unchanged, restated so they are visible here):
--   leads_insert : anyone (incl. anonymous) may insert, but ONLY on an approved
--                  listing; the set_lead_agent trigger derives agent_id from the
--                  listing, so the sender cannot address it to someone else.
--   leads_read   : only the owning agent or an admin can read enquiries.
select 'leads hardened: validated, reachable, rate-limited' as note;
