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
  leave_requests jsonb := '[]'::jsonb;
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
      'id', p->>'id',
      'driver_name', p->>'driver_name',
      'punched_at', p->>'punched_at',
      'action', p->>'action',
      'run', p->>'run',
      'note', coalesce(p->>'note', ''),
      'timecard_entries', coalesce(p->'timecard_entries', '[]'::jsonb),
      'removed', coalesce(p->>'removed', '') = 'true'
    ) order by p->>'punched_at', p->>'id'), '[]'::jsonb)
      into punches
    from jsonb_array_elements(coalesce(office->'punches', '[]'::jsonb)) p
    where lower(trim(coalesce(p->>'driver_name', ''))) = link.driver_key
      and coalesce(p->>'removed', '') <> 'true';

    select coalesce(jsonb_agg(jsonb_build_object(
      'id', r->>'id',
      'driver_name', r->>'driver_name',
      'date', r->>'date',
      'run', r->>'run',
      'minutes', coalesce((r->>'minutes')::int, 0),
      'requested_at', r->>'requested_at',
      'substitute_name', coalesce(r->>'substitute_name', '')
    ) order by r->>'date', r->>'run', r->>'id'), '[]'::jsonb)
      into leave_requests
    from jsonb_array_elements(coalesce(office->'leaveRequests', '[]'::jsonb)) r
    where lower(trim(coalesce(r->>'driver_name', ''))) = link.driver_key;
  end if;

  return jsonb_build_object(
    'driverName', link.driver_name,
    'email', coalesce(driver_email, ''),
    'periods', periods,
    'codes', case
      when office is null or jsonb_typeof(office->'clockReasonCodes') <> 'array' then '[]'::jsonb
      else office->'clockReasonCodes'
    end,
    'punches', punches,
    'leaveRequests', leave_requests
  );
end;
$$;

revoke all on function public.driver_clock_record(text) from public;
grant execute on function public.driver_clock_record(text) to anon, authenticated;

-- Updates only the timecard lines on this driver's clock-out, and only while
-- the pay period that contains that clock-out is still open.
create or replace function public.save_driver_timecard(link_token text, punch_id text, entries jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.clock_links%rowtype;
  office jsonb;
  punches jsonb;
  target jsonb;
  updated jsonb;
  rebuilt jsonb;
  catalog jsonb;
  periods jsonb;
  item jsonb;
  built jsonb := '[]'::jsonb;
  seen text[] := array[]::text[];
  code_id text;
  code_label text;
  minutes int;
  comment text;
  total int := 0;
  session_minutes int;
  open_in jsonb;
  punch jsonb;
  start_at timestamptz;
  end_at timestamptz;
  local_ts timestamp;
  day_of_month int;
  last_day int;
  start_day int;
  end_day int;
  cursor_day int := 1;
  period_end int;
  period_count int := 0;
  used text[] := array[]::text[];
  period_id text;
  deadline timestamp;
begin
  if link_token is null or char_length(link_token) < 32 or punch_id is null or punch_id = '' then
    raise exception 'This clock record link is not valid.';
  end if;
  if entries is null or jsonb_typeof(entries) <> 'array' then
    raise exception 'Choose a timecard code.';
  end if;

  select * into link
  from public.clock_links
  where token = link_token;
  if not found then
    raise exception 'This clock record link is not valid.';
  end if;

  select state into office
  from public.office_state
  where id = 'shared'
  for update;
  if office is null then
    raise exception 'Clock records are not available from this link.';
  end if;

  punches := coalesce(office->'punches', '[]'::jsonb);
  select p into target
  from jsonb_array_elements(punches) p
  where p->>'id' = punch_id
  limit 1;
  if target is null
    or lower(trim(coalesce(target->>'driver_name', ''))) <> link.driver_key
    or target->>'action' <> 'out'
    or coalesce(target->>'removed', '') = 'true' then
    raise exception 'Clock in before adding timecard codes.';
  end if;

  session_minutes := null;
  open_in := null;
  for punch in
    select p
    from jsonb_array_elements(punches) p
    where lower(trim(coalesce(p->>'driver_name', ''))) = link.driver_key
    order by p->>'punched_at', p->>'id'
  loop
    if coalesce(punch->>'removed', '') = 'true' then
      continue;
    end if;
    if punch->>'action' = 'in' then
      open_in := punch;
      continue;
    end if;
    if punch->>'action' <> 'out' or open_in is null then
      continue;
    end if;
    if punch->>'id' = punch_id then
      start_at := (open_in->>'punched_at')::timestamptz;
      end_at := (punch->>'punched_at')::timestamptz;
      session_minutes := round(abs(extract(epoch from (end_at - start_at))) / 60.0)::int;
    end if;
    open_in := null;
  end loop;
  if session_minutes is null then
    raise exception 'Clock in before adding timecard codes.';
  end if;

  local_ts := ((target->>'punched_at')::timestamptz at time zone 'America/Los_Angeles');
  day_of_month := extract(day from local_ts)::int;
  last_day := extract(day from (date_trunc('month', local_ts) + interval '1 month' - interval '1 day'))::int;
  periods := office #> '{clockPayDefaults,periods}';
  if periods is null or jsonb_typeof(periods) <> 'array' or jsonb_array_length(periods) = 0 then
    periods := '[{"id":"1","startDay":1,"endDay":15},{"id":"2","startDay":16,"endDay":31}]'::jsonb;
  end if;
  period_end := null;
  for item in select value from jsonb_array_elements(periods)
  loop
    exit when period_count >= 6;
    begin
      start_day := (item->>'startDay')::int;
      end_day := (item->>'endDay')::int;
    exception when others then
      continue;
    end;
    if start_day < 1 or start_day > 31 or end_day < 1 or end_day > 31 or end_day < start_day or start_day < cursor_day then
      continue;
    end if;
    period_id := coalesce(item->>'id', '');
    if period_id !~ '^[1-9]$' or period_id = any(used) then
      period_id := '1';
      while period_id = any(used) and period_id::int < 9 loop
        period_id := (period_id::int + 1)::text;
      end loop;
      if period_id = any(used) then
        continue;
      end if;
    end if;
    used := used || period_id;
    period_count := period_count + 1;
    if day_of_month >= start_day and day_of_month <= least(end_day, last_day) then
      period_end := least(end_day, last_day);
    end if;
    cursor_day := end_day + 1;
  end loop;
  if period_count = 0 then
    if day_of_month <= 15 then
      period_end := 15;
    else
      period_end := last_day;
    end if;
  end if;
  if period_end is null then
    raise exception 'That pay period is closed.';
  end if;
  deadline := date_trunc('day', local_ts) + (period_end - day_of_month) * interval '1 day' + time '23:59:59.999';
  if (now() at time zone 'America/Los_Angeles') > deadline then
    raise exception 'That pay period is closed.';
  end if;

  if jsonb_array_length(entries) > 10 then
    raise exception 'A clock-out can have 10 codes.';
  end if;

  catalog := office->'clockReasonCodes';
  if catalog is null or jsonb_typeof(catalog) <> 'array' then
    catalog := '[]'::jsonb;
  end if;

  for item in select value from jsonb_array_elements(entries)
  loop
    code_id := trim(coalesce(item->>'id', item->>'code_id', ''));
    if code_id = '' or (jsonb_array_length(catalog) > 0 and not exists (
      select 1 from jsonb_array_elements(catalog) code where code->>'id' = code_id
    )) then
      raise exception 'Choose a timecard code.';
    end if;
    if code_id = any(seen) then
      raise exception 'That code is already on this clock-out.';
    end if;
    seen := seen || code_id;
    begin
      minutes := (item->>'minutes')::int;
    exception when others then
      raise exception 'Enter the time for each code.';
    end;
    if minutes is null or minutes < 1 or minutes > 1440 or (item->>'minutes') !~ '^-?[0-9]+$' then
      raise exception 'Enter the time for each code.';
    end if;
    comment := trim(coalesce(item->>'comment', ''));
    if char_length(comment) > 200 then
      raise exception 'A comment can be 200 characters or fewer.';
    end if;
    select coalesce(code->>'label', '') into code_label
    from jsonb_array_elements(catalog) code
    where code->>'id' = code_id
    limit 1;
    if coalesce(code_label, '') = '' then
      code_label := trim(coalesce(item->>'label', ''));
    end if;
    if code_label = '' or char_length(code_label) > 120 then
      raise exception 'Choose a timecard code.';
    end if;
    total := total + minutes;
    built := built || jsonb_build_array(jsonb_build_object(
      'id', code_id,
      'label', code_label,
      'minutes', minutes,
      'comment', comment
    ));
  end loop;

  if total > session_minutes then
    raise exception 'Those times add up to more than this clock session.';
  end if;

  if jsonb_array_length(built) = 0 then
    updated := target - 'timecard_entries';
  else
    updated := jsonb_set(target, '{timecard_entries}', built);
  end if;

  select coalesce(jsonb_agg(
    case when elem->>'id' = punch_id then updated else elem end
    order by ord
  ), '[]'::jsonb)
    into rebuilt
  from jsonb_array_elements(punches) with ordinality as t(elem, ord);

  update public.office_state
  set state = jsonb_set(state, '{punches}', rebuilt),
      version = version + 1,
      updated_at = now()
  where id = 'shared';

  return public.driver_clock_record(link_token);
end;
$$;

revoke all on function public.save_driver_timecard(text, text, jsonb) from public;
grant execute on function public.save_driver_timecard(text, text, jsonb) to anon, authenticated;
