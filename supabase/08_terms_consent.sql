-- BlockView — record that a user accepted the Terms of Service and Privacy Policy.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- The checkbox in the sign-up form is the UI half; this is the record half.
-- A client may set the columns (it writes its own profile row), but it can NEVER
-- choose the timestamp: the guard trigger overwrites it with now(), so an
-- acceptance can't be back-dated or forged. Admins can correct it if needed.

-- ============================================== consent columns ===========
alter table public.profiles add column if not exists terms_accepted_at timestamptz;
alter table public.profiles add column if not exists terms_version     text;

do $$ begin
  alter table public.profiles add constraint profiles_terms_version_chk
    check (terms_version is null or char_length(terms_version) <= 32);
exception when duplicate_object then null; end $$;

comment on column public.profiles.terms_accepted_at is
  'When the user accepted the Terms of Service and Privacy Policy (server time).';
comment on column public.profiles.terms_version is
  'Version of the documents that was accepted (the "last updated" date).';

-- ================================== guard: role, plan and consent time ====
-- Extends the existing protection: users still cannot change their own role or
-- plan, and now the consent timestamp is always stamped server-side.
create or replace function public.protect_profile_fields()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  caller_is_admin boolean;
begin
  caller_is_admin := exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');

  -- privilege escalation / free Pro
  if (new.role is distinct from old.role) or (new.plan is distinct from old.plan) then
    if auth.uid() is not null and not caller_is_admin then
      raise exception 'FORBIDDEN_FIELD_CHANGE' using errcode = 'P0001';
    end if;
  end if;

  -- consent: the client may record it, but never pick the time
  if new.terms_accepted_at is distinct from old.terms_accepted_at then
    if auth.uid() is not null and not caller_is_admin then
      if new.terms_accepted_at is null then
        new.terms_accepted_at := old.terms_accepted_at;   -- cannot erase consent
      else
        new.terms_accepted_at := now();                   -- cannot back-date it
      end if;
    end if;
  end if;

  return new;
end; $$;

drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect before update on public.profiles
  for each row execute procedure public.protect_profile_fields();

-- ======================================================= who accepted =====
-- Existing users predate the consent flow; they are asked on next sign-in.
select count(*) filter (where terms_accepted_at is not null) as accepted,
       count(*) filter (where terms_accepted_at is null)     as pending
from   public.profiles;
