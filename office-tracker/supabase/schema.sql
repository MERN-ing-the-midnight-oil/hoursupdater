-- Shared office record and sign-in profiles for the Teamster Time Changes Dashboard.
-- Run this once in the Supabase SQL editor for the project named in SUPABASE_URL.
-- Then, in Authentication → Providers → Email, decide whether a new account
-- must click a confirmation link before signing in.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.office_state (
  id text primary key,
  state jsonb not null,
  version integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

insert into public.office_state (id, state)
values (
  'shared',
  '{"version":1,"currentProfileId":null,"profiles":{},"drivers":[]}'::jsonb
)
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.office_state enable row level security;

grant select, insert, update on public.profiles to authenticated;
grant select, update on public.office_state to authenticated;

drop policy if exists "signed in can read profiles" on public.profiles;
create policy "signed in can read profiles"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "users insert own profile" on public.profiles;
create policy "users insert own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "signed in can read office" on public.office_state;
create policy "signed in can read office"
  on public.office_state for select
  to authenticated
  using (true);

drop policy if exists "signed in can update office" on public.office_state;
create policy "signed in can update office"
  on public.office_state for update
  to authenticated
  using (true)
  with check (true);

-- The last Payroll Driver Times file this office created.
-- The next file highlights rows that differ from these.
create table if not exists public.payroll_baseline (
  id text primary key,
  rows jsonb not null,
  saved_at timestamptz,
  saved_by uuid references auth.users (id)
);

alter table public.payroll_baseline enable row level security;

grant select, insert, update on public.payroll_baseline to authenticated;

drop policy if exists "signed in can read payroll baseline" on public.payroll_baseline;
create policy "signed in can read payroll baseline"
  on public.payroll_baseline for select
  to authenticated
  using (true);

drop policy if exists "signed in can insert payroll baseline" on public.payroll_baseline;
create policy "signed in can insert payroll baseline"
  on public.payroll_baseline for insert
  to authenticated
  with check (true);

drop policy if exists "signed in can update payroll baseline" on public.payroll_baseline;
create policy "signed in can update payroll baseline"
  on public.payroll_baseline for update
  to authenticated
  using (true)
  with check (true);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
      split_part(coalesce(new.email, 'account'), '@', 1)
    )
  )
  on conflict (id) do update
    set email = excluded.email,
        display_name = excluded.display_name;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

do $$
begin
  alter publication supabase_realtime add table public.office_state;
exception
  when duplicate_object then
    null;
end $$;
