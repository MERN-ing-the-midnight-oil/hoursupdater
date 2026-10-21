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
