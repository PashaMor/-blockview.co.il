-- BlockView — short-term vs long-term rentals.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- A month's lease and a week by the beach are different products at wildly
-- different prices, and until now they were both just 'rent' — so a ₪600/night
-- holiday flat sat next to a ₪6,000/month apartment in the same results.
--
-- rent_term applies only to a rental. A sale must leave it null, so the two
-- can never disagree.

alter table public.listings add column if not exists rent_term text;

do $$ begin
  alter table public.listings add constraint listings_rent_term_chk
    check (rent_term is null or rent_term in ('short','long'));
exception when duplicate_object then null; end $$;

-- a sale has no rental term; a rental must have one from now on. NOT VALID so
-- the rows already in the table keep working and only new writes are checked.
do $$ begin
  alter table public.listings add constraint listings_rent_term_deal_chk
    check (deal <> 'sale' or rent_term is null) not valid;
exception when duplicate_object then null; end $$;

-- existing rentals predate the choice; long term is the ordinary case
update public.listings set rent_term = 'long'
 where deal = 'rent' and rent_term is null;

create index if not exists listings_rent_term_idx on public.listings (rent_term)
  where rent_term is not null;

comment on column public.listings.rent_term is
  'short = nightly/weekly holiday let, long = ordinary lease. Null for a sale.';

select deal,
       coalesce(rent_term, '—') as term,
       count(*)
from   public.listings
group  by deal, rent_term
order  by deal, term;
