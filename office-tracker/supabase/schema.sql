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
    'leaveRequests', leave_requests,
    'periodEndsAt', case
      when office is null then '23:59'
      when coalesce(office #>> '{clockPayDefaults,periodEndsAt}', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        then office #>> '{clockPayDefaults,periodEndsAt}'
      else '23:59'
    end
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
  ends_at text;
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
  ends_at := office #>> '{clockPayDefaults,periodEndsAt}';
  if ends_at is null or ends_at !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    ends_at := '23:59';
  end if;
  deadline := date_trunc('day', local_ts)
    + (period_end - day_of_month) * interval '1 day'
    + (ends_at || ':59.999')::time;
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

-- Phone links for today's clock card. The office opens a link while signed in.
-- Anyone with the link can read and change that day's notes. The link cannot punch.
-- Run this in the Supabase SQL editor after schema.sql. It is safe to run again.

create table if not exists public.clock_note_slots (
  token text primary key,
  slot_key text not null unique,
  driver_name text not null,
  run text not null,
  action text not null,
  note_date date not null,
  note text not null default '',
  reasons jsonb not null default '[]'::jsonb,
  catalog jsonb not null default '[]'::jsonb,
  revision integer not null default 1,
  editable_until timestamptz,
  touched_at timestamptz not null default now(),
  constraint clock_note_slots_token_length check (char_length(token) >= 32),
  constraint clock_note_slots_run check (run in ('AM', 'MIDDAY', 'PM', 'OTHER')),
  constraint clock_note_slots_action check (action in ('in', 'out'))
);

create table if not exists public.clock_note_days (
  token text primary key,
  day_key text not null unique,
  driver_name text not null,
  note_date date not null,
  catalog jsonb not null default '[]'::jsonb,
  rows jsonb not null default '[]'::jsonb,
  editable_until timestamptz,
  touched_at timestamptz not null default now(),
  constraint clock_note_days_token_length check (char_length(token) >= 32)
);

alter table public.clock_note_slots enable row level security;
alter table public.clock_note_days enable row level security;

revoke all on table public.clock_note_slots from anon, authenticated;
revoke all on table public.clock_note_days from anon, authenticated;

create or replace function public.clock_note_label(route text, side text)
returns text
language sql
immutable
as $$
  select case
    when route in ('AM', 'MIDDAY', 'PM', 'OTHER') and side in ('in', 'out') then
      (case route when 'MIDDAY' then 'MID' else route end)
      || ' '
      || (case side when 'in' then 'IN' else 'OUT' end)
    else ''
  end
$$;

create or replace function public.clock_note_text(raw text)
returns text
language plpgsql
immutable
as $$
declare
  note text := btrim(coalesce(raw, ''));
begin
  if char_length(note) > 500 then
    raise exception 'A note can be 500 characters or fewer.';
  end if;
  return note;
end;
$$;

create or replace function public.clock_note_until(raw text)
returns timestamptz
language plpgsql
immutable
as $$
begin
  if raw is null or btrim(raw) = '' then
    return null;
  end if;
  begin
    return raw::timestamptz;
  exception when others then
    raise exception 'That pay period end time is not valid.';
  end;
end;
$$;

create or replace function public.clock_note_catalog(raw jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  item jsonb;
  code_id text;
  code_label text;
  seen text[] := array[]::text[];
  codes jsonb := '[]'::jsonb;
begin
  if raw is null or jsonb_typeof(raw) <> 'array' then
    return '[]'::jsonb;
  end if;
  for item in select value from jsonb_array_elements(raw)
  loop
    exit when jsonb_array_length(codes) >= 80;
    if jsonb_typeof(item) <> 'object' then
      continue;
    end if;
    code_id := btrim(coalesce(item->>'id', ''));
    code_label := btrim(coalesce(item->>'label', ''));
    if code_id = '' or code_label = '' or char_length(code_label) > 120 or code_id = any(seen) then
      continue;
    end if;
    seen := seen || code_id;
    codes := codes || jsonb_build_array(jsonb_build_object('id', code_id, 'label', code_label));
  end loop;
  return codes;
end;
$$;

create or replace function public.clock_note_reasons(raw jsonb, catalog jsonb, already jsonb, strict boolean)
returns jsonb
language plpgsql
stable
as $$
declare
  item jsonb;
  code jsonb;
  allowed jsonb := '{}'::jsonb;
  code_id text;
  minutes int;
  seen text[] := array[]::text[];
  reasons jsonb := '[]'::jsonb;
begin
  if catalog is not null and jsonb_typeof(catalog) = 'array' then
    for code in select value from jsonb_array_elements(catalog)
    loop
      if coalesce(code->>'id', '') <> '' then
        allowed := allowed || jsonb_build_object(code->>'id', coalesce(code->>'label', ''));
      end if;
    end loop;
  end if;
  if already is not null and jsonb_typeof(already) = 'array' then
    for code in select value from jsonb_array_elements(already)
    loop
      code_id := coalesce(code->>'id', '');
      if code_id <> '' and not (allowed ? code_id) then
        allowed := allowed || jsonb_build_object(code_id, coalesce(code->>'label', ''));
      end if;
    end loop;
  end if;
  if raw is null or jsonb_typeof(raw) <> 'array' then
    if not strict then
      return '[]'::jsonb;
    end if;
    raise exception 'Choose a reason.';
  end if;
  for item in select value from jsonb_array_elements(raw)
  loop
    if jsonb_array_length(reasons) >= 20 then
      raise exception 'That note has too many reasons.';
    end if;
    if item is null or jsonb_typeof(item) <> 'object' then
      if strict then
        raise exception 'Choose a reason.';
      end if;
      continue;
    end if;
    code_id := btrim(coalesce(item->>'id', ''));
    if code_id = '' or not (allowed ? code_id) or code_id = any(seen) then
      if strict then
        if code_id <> '' and code_id = any(seen) then
          raise exception 'That reason is already on this note.';
        end if;
        raise exception 'Choose a reason.';
      end if;
      continue;
    end if;
    begin
      if coalesce(item->>'minutes', '') !~ '^[0-9]+$' then
        raise exception 'minutes';
      end if;
      minutes := (item->>'minutes')::int;
      if minutes < 1 or minutes > 1440 then
        raise exception 'minutes';
      end if;
    exception when others then
      if strict then
        raise exception 'Use whole minutes, up to 1440.';
      end if;
      continue;
    end;
    seen := seen || code_id;
    reasons := reasons || jsonb_build_array(jsonb_build_object(
      'id', code_id,
      'label', allowed->>code_id,
      'minutes', minutes
    ));
  end loop;
  return reasons;
end;
$$;

create or replace function public.clock_note_public(slot public.clock_note_slots)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'token', slot.token,
    'driverName', slot.driver_name,
    'run', slot.run,
    'action', slot.action,
    'date', to_char(slot.note_date, 'YYYY-MM-DD'),
    'label', public.clock_note_label(slot.run, slot.action),
    'note', slot.note,
    'reasons', slot.reasons,
    'catalog', slot.catalog,
    'revision', slot.revision,
    'editableUntil', slot.editable_until,
    'closed', slot.editable_until is not null and now() > slot.editable_until
  );
$$;

create or replace function public.clock_note_prune()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.clock_note_slots where touched_at < now() - interval '36 hours';
  delete from public.clock_note_days where touched_at < now() - interval '36 hours';
end;
$$;

create or replace function public.clock_note_open_slot(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  name text;
  route text;
  side text;
  day date;
  key text;
  until_at timestamptz;
  cats jsonb;
  link text;
  slot public.clock_note_slots%rowtype;
begin
  perform public.clock_note_prune();
  name := btrim(coalesce(payload->>'driverName', ''));
  if name = '' or char_length(name) > 80 then
    raise exception 'Choose a driver.';
  end if;
  route := coalesce(payload->>'run', '');
  side := coalesce(payload->>'action', '');
  if route not in ('AM', 'MIDDAY', 'PM', 'OTHER') or side not in ('in', 'out') then
    raise exception 'That notes link is not valid.';
  end if;
  if coalesce(payload->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'That notes link is not valid.';
  end if;
  day := (payload->>'date')::date;
  until_at := public.clock_note_until(payload->>'editableUntil');
  cats := public.clock_note_catalog(payload->'catalog');
  key := lower(name) || '|' || (payload->>'date') || '|' || route || '|' || side;
  select * into slot from public.clock_note_slots where slot_key = key for update;
  if found then
    update public.clock_note_slots
      set driver_name = name,
          catalog = cats,
          editable_until = coalesce(until_at, editable_until),
          touched_at = now()
      where token = slot.token
      returning * into slot;
    return public.clock_note_public(slot);
  end if;

  link := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  begin
    insert into public.clock_note_slots (
      token, slot_key, driver_name, run, action, note_date, note, reasons, catalog, revision, editable_until, touched_at
    ) values (
      link,
      key,
      name,
      route,
      side,
      day,
      public.clock_note_text(payload->>'note'),
      public.clock_note_reasons(payload->'reasons', cats, '[]'::jsonb, false),
      cats,
      1,
      until_at,
      now()
    )
    returning * into slot;
  exception when unique_violation then
    update public.clock_note_slots
      set driver_name = name,
          catalog = cats,
          editable_until = coalesce(until_at, editable_until),
          touched_at = now()
      where slot_key = key
      returning * into slot;
  end;
  return public.clock_note_public(slot);
end;
$$;

create or replace function public.open_clock_note(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to open a notes link.';
  end if;
  return public.clock_note_open_slot(payload);
end;
$$;

create or replace function public.clock_note_day_public(day public.clock_note_days)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  item jsonb;
  slot public.clock_note_slots%rowtype;
  built jsonb := '[]'::jsonb;
begin
  if day.rows is not null and jsonb_typeof(day.rows) = 'array' then
    for item in select value from jsonb_array_elements(day.rows)
    loop
      update public.clock_note_slots
        set touched_at = now()
        where token = item->>'token'
        returning * into slot;
      if not found then
        continue;
      end if;
      built := built || jsonb_build_array(jsonb_build_object(
        'token', slot.token,
        'run', slot.run,
        'action', slot.action,
        'label', public.clock_note_label(slot.run, slot.action),
        'clock', coalesce(item->>'clock', ''),
        'note', slot.note,
        'reasons', slot.reasons,
        'revision', slot.revision
      ));
    end loop;
  end if;
  return jsonb_build_object(
    'token', day.token,
    'driverName', day.driver_name,
    'date', to_char(day.note_date, 'YYYY-MM-DD'),
    'catalog', day.catalog,
    'rows', built,
    'editableUntil', day.editable_until,
    'closed', day.editable_until is not null and now() > day.editable_until
  );
end;
$$;

create or replace function public.open_clock_note_day(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  name text;
  day date;
  until_at timestamptz;
  cats jsonb;
  item jsonb;
  seen text[] := array[]::text[];
  row_id text;
  identity_run text;
  identity_side text;
  opened jsonb;
  built jsonb := '[]'::jsonb;
  key text;
  link text;
  saved public.clock_note_days%rowtype;
  count int := 0;
begin
  if auth.uid() is null then
    raise exception 'Sign in to open a notes link.';
  end if;
  perform public.clock_note_prune();
  name := btrim(coalesce(payload->>'driverName', ''));
  if name = '' or char_length(name) > 80 then
    raise exception 'Choose a driver.';
  end if;
  if coalesce(payload->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'That notes link is not valid.';
  end if;
  day := (payload->>'date')::date;
  until_at := public.clock_note_until(payload->>'editableUntil');
  cats := public.clock_note_catalog(payload->'catalog');
  if payload->'rows' is not null and jsonb_typeof(payload->'rows') = 'array' then
    for item in select value from jsonb_array_elements(payload->'rows')
    loop
      exit when count >= 12;
      identity_run := coalesce(item->>'run', '');
      identity_side := coalesce(item->>'action', '');
      if identity_run not in ('AM', 'MIDDAY', 'PM', 'OTHER') or identity_side not in ('in', 'out') then
        continue;
      end if;
      row_id := identity_run || '|' || identity_side;
      if row_id = any(seen) then
        continue;
      end if;
      seen := seen || row_id;
      opened := public.clock_note_open_slot(jsonb_build_object(
        'driverName', name,
        'run', identity_run,
        'action', identity_side,
        'date', payload->>'date',
        'editableUntil', case when until_at is null then null::jsonb else to_jsonb(until_at) end,
        'note', item->>'note',
        'reasons', coalesce(item->'reasons', '[]'::jsonb),
        'catalog', cats
      ));
      built := built || jsonb_build_array(jsonb_build_object(
        'token', opened->>'token',
        'clock', left(regexp_replace(btrim(coalesce(item->>'clock', '')), '\s+', ' ', 'g'), 80)
      ));
      count := count + 1;
    end loop;
  end if;
  key := lower(name) || '|' || (payload->>'date') || '|day';
  link := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.clock_note_days (
    token, day_key, driver_name, note_date, catalog, rows, editable_until, touched_at
  ) values (
    link, key, name, day, cats, built, until_at, now()
  )
  on conflict (day_key) do update
    set driver_name = excluded.driver_name,
        catalog = excluded.catalog,
        rows = excluded.rows,
        editable_until = coalesce(excluded.editable_until, public.clock_note_days.editable_until),
        touched_at = now()
  returning * into saved;
  return public.clock_note_day_public(saved);
end;
$$;

create or replace function public.read_clock_note(link_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  slot public.clock_note_slots%rowtype;
begin
  perform public.clock_note_prune();
  if link_token is null or char_length(link_token) < 32 then
    return null;
  end if;
  update public.clock_note_slots
    set touched_at = now()
    where token = link_token
    returning * into slot;
  if not found then
    return null;
  end if;
  return public.clock_note_public(slot);
end;
$$;

create or replace function public.read_clock_note_day(link_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  day public.clock_note_days%rowtype;
begin
  perform public.clock_note_prune();
  if link_token is null or char_length(link_token) < 32 then
    return null;
  end if;
  update public.clock_note_days
    set touched_at = now()
    where token = link_token
    returning * into day;
  if not found then
    return null;
  end if;
  return public.clock_note_day_public(day);
end;
$$;

create or replace function public.save_clock_note(link_token text, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  slot public.clock_note_slots%rowtype;
  claimed int;
  next_note text;
  next_reasons jsonb;
begin
  perform public.clock_note_prune();
  if link_token is null or char_length(link_token) < 32 then
    return null;
  end if;
  select * into slot
  from public.clock_note_slots
  where token = link_token
  for update;
  if not found then
    return null;
  end if;
  if slot.editable_until is not null and now() > slot.editable_until then
    raise exception 'That pay period is closed.';
  end if;
  begin
    claimed := (payload->>'revision')::int;
  exception when others then
    claimed := null;
  end;
  if claimed is null or claimed <> slot.revision or coalesce(payload->>'revision', '') !~ '^-?[0-9]+$' then
    return jsonb_build_object('conflict', true, 'slot', public.clock_note_public(slot));
  end if;
  next_note := public.clock_note_text(payload->>'note');
  next_reasons := public.clock_note_reasons(payload->'reasons', slot.catalog, slot.reasons, true);
  update public.clock_note_slots
    set note = next_note,
        reasons = next_reasons,
        revision = revision + 1,
        touched_at = now()
    where token = link_token
    returning * into slot;
  return jsonb_build_object('conflict', false, 'slot', public.clock_note_public(slot));
end;
$$;

revoke all on function public.clock_note_label(text, text) from public, anon, authenticated;
revoke all on function public.clock_note_text(text) from public, anon, authenticated;
revoke all on function public.clock_note_until(text) from public, anon, authenticated;
revoke all on function public.clock_note_catalog(jsonb) from public, anon, authenticated;
revoke all on function public.clock_note_reasons(jsonb, jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.clock_note_public(public.clock_note_slots) from public, anon, authenticated;
revoke all on function public.clock_note_prune() from public, anon, authenticated;
revoke all on function public.clock_note_open_slot(jsonb) from public, anon, authenticated;
revoke all on function public.clock_note_day_public(public.clock_note_days) from public, anon, authenticated;

revoke all on function public.open_clock_note(jsonb) from public;
revoke all on function public.open_clock_note_day(jsonb) from public;
revoke all on function public.read_clock_note(text) from public;
revoke all on function public.read_clock_note_day(text) from public;
revoke all on function public.save_clock_note(text, jsonb) from public;

grant execute on function public.open_clock_note(jsonb) to authenticated;
grant execute on function public.open_clock_note_day(jsonb) to authenticated;
grant execute on function public.read_clock_note(text) to anon, authenticated;
grant execute on function public.read_clock_note_day(text) to anon, authenticated;
grant execute on function public.save_clock_note(text, jsonb) to anon, authenticated;

-- Read-only route history for the public driver page.
-- The password is a bot gate. The result is route names, driver names,
-- assignment dates, and clock-time changes. Punches, mail, and pay stay out.
create or replace function public.public_route_history(pass text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  office jsonb;
  profiles jsonb;
begin
  if pass is distinct from '07041776' then
    return null;
  end if;

  select state into office
  from public.office_state
  where id = 'shared';

  if office is null or jsonb_typeof(office->'profiles') <> 'object' then
    return jsonb_build_object('schoolYear', null, 'profiles', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(profile_row order by profile_row->>'name'), '[]'::jsonb)
    into profiles
  from (
    select jsonb_strip_nulls(jsonb_build_object(
      'id', coalesce(p.value->>'id', p.key),
      'name', coalesce(p.value->>'name', ''),
      'driver_name', coalesce(p.value->>'driver_name', ''),
      'start_date', p.value->>'start_date',
      'assignments', (
        select coalesce(jsonb_agg(
          jsonb_strip_nulls(jsonb_build_object(
            'driver_name', coalesce(a.value->>'driver_name', ''),
            'from', a.value->>'from',
            'until', a.value->>'until'
          ))
          order by a.ordinality
        ), '[]'::jsonb)
        from jsonb_array_elements(
          case
            when jsonb_typeof(p.value->'assignments') = 'array' then p.value->'assignments'
            else '[]'::jsonb
          end
        ) with ordinality as a(value, ordinality)
        where coalesce(a.value->>'driver_name', '') <> ''
          and coalesce(a.value->>'from', '') <> ''
      ),
      'changeLog', (
        select coalesce(jsonb_agg(
          jsonb_strip_nulls(jsonb_build_object(
            'id', e.value->>'id',
            'type', e.value->>'type',
            'route_id', e.value->>'route_id',
            'segment', e.value->>'segment',
            'effective_date', e.value->>'effective_date',
            'submitted_at', e.value->>'submitted_at',
            'previous_time', e.value->>'previous_time',
            'new_time', e.value->>'new_time',
            'computed_delta_minutes', e.value->'computed_delta_minutes',
            'delta_minutes', e.value->'delta_minutes',
            'note', e.value->>'note',
            'driver_name', e.value->>'driver_name',
            'force_oct1_contract', e.value->'force_oct1_contract',
            'reason_category', e.value->>'reason_category',
            'routing_adjustment', case
              when jsonb_typeof(e.value->'routing_adjustment') = 'object'
                then jsonb_strip_nulls(jsonb_build_object(
                  'reason', e.value #>> '{routing_adjustment,reason}'
                ))
              else null
            end
          ))
          order by e.ordinality
        ), '[]'::jsonb)
        from jsonb_array_elements(
          case
            when jsonb_typeof(p.value->'changeLog') = 'array' then p.value->'changeLog'
            else '[]'::jsonb
          end
        ) with ordinality as e(value, ordinality)
      )
    )) as profile_row
    from jsonb_each(office->'profiles') as p(key, value)
  ) built;

  return jsonb_build_object(
    'schoolYear', case
      when jsonb_typeof(office->'schoolYear') = 'object' then office->'schoolYear'
      else null
    end,
    'profiles', profiles
  );
end;
$$;

revoke all on function public.public_route_history(text) from public;
grant execute on function public.public_route_history(text) to anon, authenticated;
