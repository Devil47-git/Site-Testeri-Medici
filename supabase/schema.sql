create table if not exists public.app_kv (
  key text primary key,
  kind text not null check (kind in ('string', 'hash', 'set')),
  value jsonb not null,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.app_kv enable row level security;
revoke all on table public.app_kv from public, anon, authenticated;
grant all on table public.app_kv to service_role;

create or replace function public.app_kv_execute(p_command text, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_command text := upper(p_command);
  v_args jsonb := coalesce(p_args, '[]'::jsonb);
  v_key text;
  v_kind text;
  v_value jsonb;
  v_expires_at timestamptz;
  v_field text;
  v_arg text;
  v_result jsonb;
  v_count integer;
  v_nx boolean := false;
  v_expiration integer;
  v_index integer;
  v_exists boolean;
begin
  if jsonb_typeof(v_args) is distinct from 'array' or jsonb_array_length(v_args) < 1 then
    raise exception 'Invalid app_kv command arguments';
  end if;

  v_key := v_args ->> 0;
  if v_key is null or v_key = '' then
    raise exception 'Storage key cannot be empty';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));
  select kind, value, expires_at
    into v_kind, v_value, v_expires_at
    from public.app_kv
    where key = v_key
    for update;
  v_exists := found;

  if v_exists and v_expires_at is not null and v_expires_at <= now() then
    delete from public.app_kv where key = v_key;
    v_exists := false;
    v_kind := null;
    v_value := null;
    v_expires_at := null;
  end if;

  if v_command = 'GET' then
    if jsonb_array_length(v_args) <> 1 then raise exception 'GET expects one key'; end if;
    if not v_exists then return 'null'::jsonb; end if;
    if v_kind <> 'string' then raise exception 'WRONGTYPE key is not a string'; end if;
    return v_value;
  elsif v_command = 'SET' then
    if jsonb_array_length(v_args) < 2 then raise exception 'SET expects a key and value'; end if;
    v_arg := v_args ->> 1;
    v_index := 2;
    while v_index < jsonb_array_length(v_args) loop
      if upper(v_args ->> v_index) = 'NX' then
        v_nx := true;
        v_index := v_index + 1;
      elsif upper(v_args ->> v_index) = 'EX' and v_index + 1 < jsonb_array_length(v_args) then
        v_expiration := (v_args ->> (v_index + 1))::integer;
        if v_expiration <= 0 then raise exception 'SET expiration must be positive'; end if;
        v_index := v_index + 2;
      else
        raise exception 'Unsupported SET option';
      end if;
    end loop;
    if v_nx and v_exists then return 'null'::jsonb; end if;
    insert into public.app_kv(key, kind, value, expires_at, updated_at)
      values (
        v_key,
        'string',
        to_jsonb(v_arg),
        case when v_expiration is null then null else now() + make_interval(secs => v_expiration) end,
        now()
      )
      on conflict (key) do update
        set kind = excluded.kind, value = excluded.value, expires_at = excluded.expires_at, updated_at = now();
    return to_jsonb('OK'::text);
  elsif v_command = 'DEL' then
    delete from public.app_kv where key = v_key;
    return to_jsonb(case when found then 1 else 0 end);
  elsif v_command = 'EXISTS' then
    return to_jsonb(case when v_exists then 1 else 0 end);
  elsif v_command = 'TTL' then
    if not v_exists then return to_jsonb(-2); end if;
    if v_expires_at is null then return to_jsonb(-1); end if;
    return to_jsonb(greatest(0, floor(extract(epoch from (v_expires_at - now())))::integer));
  elsif v_command = 'HSET' then
    if jsonb_array_length(v_args) <> 3 then raise exception 'HSET expects a key, field, and value'; end if;
    if v_exists and v_kind <> 'hash' then raise exception 'WRONGTYPE key is not a hash'; end if;
    v_field := v_args ->> 1;
    v_arg := v_args ->> 2;
    v_result := case when coalesce(v_value, '{}'::jsonb) ? v_field then '0'::jsonb else '1'::jsonb end;
    v_value := coalesce(v_value, '{}'::jsonb) || jsonb_build_object(v_field, v_arg);
    insert into public.app_kv(key, kind, value, expires_at, updated_at)
      values (v_key, 'hash', v_value, v_expires_at, now())
      on conflict (key) do update set value = excluded.value, updated_at = now();
    return v_result;
  elsif v_command = 'HGETALL' then
    if jsonb_array_length(v_args) <> 1 then raise exception 'HGETALL expects one key'; end if;
    if not v_exists then return '[]'::jsonb; end if;
    if v_kind <> 'hash' then raise exception 'WRONGTYPE key is not a hash'; end if;
    select coalesce(jsonb_agg(item order by field, item_order), '[]'::jsonb)
      into v_result
      from (
        select key as field, 1 as item_order, to_jsonb(key) as item
          from jsonb_object_keys(v_value) as keys(key)
        union all
        select key as field, 2 as item_order, value as item from jsonb_each(v_value)
      ) as pairs;
    return v_result;
  elsif v_command = 'HMGET' then
    if jsonb_array_length(v_args) < 2 then raise exception 'HMGET expects one or more fields'; end if;
    if v_exists and v_kind <> 'hash' then raise exception 'WRONGTYPE key is not a hash'; end if;
    select coalesce(jsonb_agg(case when v_exists then coalesce(v_value -> (item.value #>> '{}'), 'null'::jsonb) else 'null'::jsonb end order by item.ordinality), '[]'::jsonb)
      into v_result
      from jsonb_array_elements(v_args) with ordinality as item(value, ordinality)
      where item.ordinality > 1;
    return v_result;
  elsif v_command = 'HDEL' then
    if jsonb_array_length(v_args) < 2 then raise exception 'HDEL expects one or more fields'; end if;
    if not v_exists then return '0'::jsonb; end if;
    if v_kind <> 'hash' then raise exception 'WRONGTYPE key is not a hash'; end if;
    v_count := 0;
    for v_index in 1..jsonb_array_length(v_args) - 1 loop
      v_field := v_args ->> v_index;
      if v_value ? v_field then
        v_value := v_value - v_field;
        v_count := v_count + 1;
      end if;
    end loop;
    if v_count > 0 then
      if v_value = '{}'::jsonb then
        delete from public.app_kv where key = v_key;
      else
        update public.app_kv set value = v_value, updated_at = now() where key = v_key;
      end if;
    end if;
    return to_jsonb(v_count);
  elsif v_command = 'SADD' then
    if jsonb_array_length(v_args) < 2 then raise exception 'SADD expects one or more members'; end if;
    if v_exists and v_kind <> 'set' then raise exception 'WRONGTYPE key is not a set'; end if;
    v_value := coalesce(v_value, '[]'::jsonb);
    v_count := 0;
    for v_index in 1..jsonb_array_length(v_args) - 1 loop
      v_arg := v_args ->> v_index;
      if not v_value @> jsonb_build_array(v_arg) then
        v_value := v_value || jsonb_build_array(v_arg);
        v_count := v_count + 1;
      end if;
    end loop;
    insert into public.app_kv(key, kind, value, expires_at, updated_at)
      values (v_key, 'set', v_value, v_expires_at, now())
      on conflict (key) do update set value = excluded.value, updated_at = now();
    return to_jsonb(v_count);
  elsif v_command = 'SMEMBERS' then
    if jsonb_array_length(v_args) <> 1 then raise exception 'SMEMBERS expects one key'; end if;
    if not v_exists then return '[]'::jsonb; end if;
    if v_kind <> 'set' then raise exception 'WRONGTYPE key is not a set'; end if;
    return v_value;
  else
    raise exception 'Unsupported app_kv command: %', v_command;
  end if;
end;
$$;

create or replace function public.app_kv_pipeline(p_commands jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_command jsonb;
  v_results jsonb := '[]'::jsonb;
  v_args jsonb;
begin
  if jsonb_typeof(p_commands) is distinct from 'array' then raise exception 'Pipeline commands must be an array'; end if;
  for v_command in select value from jsonb_array_elements(p_commands)
  loop
    select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb)
      into v_args
      from jsonb_array_elements(v_command) with ordinality
      where ordinality > 1;
    v_results := v_results || jsonb_build_array(public.app_kv_execute(v_command ->> 0, v_args));
  end loop;
  return v_results;
end;
$$;

create or replace function public.app_kv_import(p_entries jsonb)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_entry jsonb;
  v_inserted integer := 0;
  v_count integer;
  v_kind text;
begin
  if jsonb_typeof(p_entries) is distinct from 'array' then raise exception 'Import entries must be an array'; end if;
  for v_entry in select value from jsonb_array_elements(p_entries)
  loop
    v_kind := v_entry ->> 'kind';
    if coalesce(v_entry ->> 'key', '') = '' or v_kind is null or v_kind not in ('string', 'hash', 'set') then
      raise exception 'Import entry has an invalid key or type';
    end if;
    if v_kind = 'string' and jsonb_typeof(v_entry -> 'value') <> 'string' then
      raise exception 'Imported string value is invalid';
    elsif v_kind = 'hash' and jsonb_typeof(v_entry -> 'value') <> 'object' then
      raise exception 'Imported hash value is invalid';
    elsif v_kind = 'set' and jsonb_typeof(v_entry -> 'value') <> 'array' then
      raise exception 'Imported set value is invalid';
    end if;
    insert into public.app_kv(key, kind, value, expires_at, updated_at)
      values (
        v_entry ->> 'key',
        v_kind,
        v_entry -> 'value',
        nullif(v_entry ->> 'expiresAt', '')::timestamptz,
        now()
      )
      on conflict (key) do update
        set kind = excluded.kind, value = excluded.value, expires_at = excluded.expires_at, updated_at = now()
        where public.app_kv.expires_at is not null and public.app_kv.expires_at <= now();
    get diagnostics v_count = row_count;
    v_inserted := v_inserted + v_count;
  end loop;
  return v_inserted;
end;
$$;

revoke all on function public.app_kv_execute(text, jsonb) from public, anon, authenticated;
revoke all on function public.app_kv_pipeline(jsonb) from public, anon, authenticated;
revoke all on function public.app_kv_import(jsonb) from public, anon, authenticated;
grant execute on function public.app_kv_execute(text, jsonb) to service_role;
grant execute on function public.app_kv_pipeline(jsonb) to service_role;
grant execute on function public.app_kv_import(jsonb) to service_role;
