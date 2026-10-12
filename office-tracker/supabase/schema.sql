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

-- One unguessable link per driver. Anyone with the link can read that
-- driver's clock sheet. The rest of the office stays signed-in only.
create table if not exists public.clock_links (
  token text primary key,
  driver_key text not null unique,
  driver_name text not null,
  created_at timestamptz not null default now(),
  constraint clock_links_token_length check (char_length(token) >= 32),
  constraint clock_links_key_matches check (driver_key = lower(trim(driver_name)) and driver_key <> '')
);

alter table public.clock_links enable row level security;

revoke all on table public.clock_links from anon;
grant select, insert, update on public.clock_links to authenticated;

drop policy if exists "signed in can read clock links" on public.clock_links;
create policy "signed in can read clock links"
  on public.clock_links for select
  to authenticated
  using (true);

drop policy if exists "signed in can insert clock links" on public.clock_links;
create policy "signed in can insert clock links"
  on public.clock_links for insert
  to authenticated
  with check (true);

drop policy if exists "signed in can update clock links" on public.clock_links;
create policy "signed in can update clock links"
  on public.clock_links for update
  to authenticated
  using (true)
  with check (true);

create or replace function public.driver_clock_record(link_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link public.clock_links%rowtype;
  office jsonb;
  driver_email text := '';
  periods jsonb := '[]'::jsonb;
  punches jsonb := '[]'::jsonb;
begin
  if link_token is null or char_length(link_token) < 32 then
    return null;
  end if;

  select * into link
  from public.clock_links
  where token = link_token;

  if not found then
    return null;
  end if;

  select state into office
  from public.office_state
  where id = 'shared';

  if office is not null then
    select coalesce(d->>'email', '')
      into driver_email
    from jsonb_array_elements(coalesce(office->'drivers', '[]'::jsonb)) d
    where lower(trim(coalesce(d->>'name', ''))) = link.driver_key
    limit 1;

    periods := coalesce(office #> '{clockPayDefaults,periods}', '[]'::jsonb);
    if jsonb_typeof(periods) <> 'array' then
      periods := '[]'::jsonb;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'driver_name', p->>'driver_name',
      'punched_at', p->>'punched_at',
      'action', p->>'action',
      'run', p->>'run',
      'removed', coalesce(p->>'removed', '') = 'true'
    )), '[]'::jsonb)
      into punches
    from jsonb_array_elements(coalesce(office->'punches', '[]'::jsonb)) p
    where lower(trim(coalesce(p->>'driver_name', ''))) = link.driver_key
      and coalesce(p->>'removed', '') <> 'true';
  end if;

  return jsonb_build_object(
    'driverName', link.driver_name,
    'email', coalesce(driver_email, ''),
    'periods', periods,
    'punches', punches
  );
end;
$$;

revoke all on function public.driver_clock_record(text) from public;
grant execute on function public.driver_clock_record(text) to anon, authenticated;
