-- Безопасность: закрытые таблицы, длинный код записи, лимиты частоты,
-- запрет записи в прошлое, search_path у SECURITY DEFINER.
--
-- Что меняет (FIXES.md, блок 1):
--   1.1  tenants / tenant_settings больше не читаются анонимно. Сайт берёт
--        правки владельца только через studio_patch, настройки целиком —
--        из файла в сборке. studio_config (полный конфиг) снят с anon.
--   1.2  У anon нет прав на таблицы public вообще (ни SELECT, ни записи):
--        вся работа посетителя — через RPC.
--   1.3  Код записи — 8 символов из gen_random_bytes, алфавит без 0/O/1/I/L.
--   1.4  Лимиты частоты: create_booking, cancel_booking, my_bookings.
--   1.5  SECURITY DEFINER: search_path = public, pg_temp; права заново.
--   1.6  Запись в прошлое отклоняется (клиент — всегда, владелец — если
--        начало раньше, чем 15 минут назад: клиент уже приехал).
--
-- Повторный запуск безопасен.

-- ---------------------------------------------------------------------------
-- 1.1 / 1.2  Прямой доступ к таблицам
-- ---------------------------------------------------------------------------

-- Студии: читать таблицу может только владелец (кабинет, скрипты под
-- service_role RLS не касается). Посетитель получает данные через RPC.
drop policy if exists tenants_read on public.tenants;
drop policy if exists tenants_owner_read on public.tenants;
create policy tenants_owner_read on public.tenants
  for select to authenticated
  using (public.is_tenant_owner(slug));

-- Правки владельца: то же самое, публично — только studio_patch.
drop policy if exists tenant_settings_read on public.tenant_settings;
drop policy if exists tenant_settings_owner_read on public.tenant_settings;
create policy tenant_settings_owner_read on public.tenant_settings
  for select to authenticated
  using (public.is_tenant_owner(tenant_slug));

-- Табличные права. Supabase по умолчанию выдаёт anon всё на всё — RLS
-- остаётся единственной защитой, и одна ошибка в политике открывает
-- таблицу. Забираем права целиком: аноним ходит только через функции.
do $$
declare r record;
begin
  for r in
    select c.oid::regclass as rel
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
  loop
    execute format('revoke all on table %s from anon', r.rel);
  end loop;
end;
$$;
-- И для таблиц, созданных позже.
alter default privileges in schema public revoke all on tables from anon;

-- ---------------------------------------------------------------------------
-- 1.4  Счётчик для лимитов частоты
-- ---------------------------------------------------------------------------

create table if not exists public.rate_events (
  id         bigserial primary key,
  kind       text        not null,
  key        text        not null,
  created_at timestamptz not null default now()
);
create index if not exists rate_events_lookup_idx on public.rate_events (kind, key, created_at desc);
alter table public.rate_events enable row level security;
-- Политик нет: пишут и читают только функции ниже.
revoke all on table public.rate_events from anon, authenticated;

-- IP посетителя из заголовков, которые PostgREST кладёт в request.headers.
-- cf-connecting-ip ставит Cloudflare перед Supabase и подделать его через
-- Cloudflare нельзя; x-forwarded-for — запасной вариант. Нет заголовков
-- (локальные тесты, вызов из SQL) — null, и лимит по IP не применяется.
create or replace function public.request_ip()
returns text
language plpgsql
stable
as $$
declare
  h jsonb;
begin
  begin
    h := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  exception when others then
    return null;
  end;
  return nullif(trim(split_part(coalesce(h ->> 'cf-connecting-ip', h ->> 'x-real-ip', h ->> 'x-forwarded-for', ''), ',', 1)), '');
end;
$$;

-- true — можно; false — лимит исчерпан. При p_record событие засчитывается.
-- Событие пишется в той же транзакции: если вызов дальше упадёт с ошибкой,
-- оно откатится — считаются только состоявшиеся действия.
create or replace function public.rate_allow(
  p_kind   text,
  p_key    text,
  p_limit  int,
  p_window interval,
  p_record boolean default true
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  n int;
begin
  if p_key is null or p_key = '' then
    return true;
  end if;

  -- Очередь на ключ: параллельные запросы не проскочат лимит вдвоём.
  perform pg_advisory_xact_lock(hashtextextended('rate:' || p_kind || ':' || p_key, 0));

  select count(*) into n
  from public.rate_events e
  where e.kind = p_kind and e.key = p_key and e.created_at > now() - p_window;

  if n >= p_limit then
    return false;
  end if;

  if p_record then
    insert into public.rate_events (kind, key) values (p_kind, p_key);
  end if;

  -- Изредка чистим старое, чтобы таблица не росла бесконечно.
  if random() < 0.01 then
    delete from public.rate_events where created_at < now() - interval '2 days';
  end if;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1.3  Код записи
-- ---------------------------------------------------------------------------

-- 8 символов из 31-символьного алфавита (без 0, O, 1, I, L): 31^8 ≈ 8,5·10^11.
-- Байты берём из gen_random_bytes (криптостойкий ГСЧ), а не random().
-- Отбрасываем байты ≥ 248 (= 31·8), иначе первые символы алфавита
-- выпадали бы чаще остальных.
create or replace function public.new_booking_code(p_slug text)
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code_len constant int := 8;
  v_code   text;
  buf      bytea;
  b        int;
  i        int;
begin
  loop
    v_code := '';
    while length(v_code) < code_len loop
      buf := gen_random_bytes(16);
      for i in 0..length(buf) - 1 loop
        b := get_byte(buf, i);
        if b < 248 then
          v_code := v_code || substr(alphabet, 1 + (b % 31), 1);
          exit when length(v_code) = code_len;
        end if;
      end loop;
    end loop;
    exit when not exists (select 1 from public.bookings x where x.tenant_slug = p_slug and x.code = v_code);
  end loop;
  return v_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1.6  Ядро записи: запрет прошедшего времени
-- ---------------------------------------------------------------------------

create or replace function public.insert_booking_core(
  p_slug          text,
  p_config        jsonb,
  p_service_id    text,
  p_start         timestamptz,
  p_name          text,
  p_phone         text,
  p_car           text,
  p_comment       text,
  p_request_id    uuid,
  p_source        text,
  p_enforce_rules boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  service     jsonb;
  existing    public.bookings%rowtype;
  v_end       timestamptz;
  buffer_min  int := coalesce((p_config ->> 'bufferMin')::int, 0);
  min_notice  int := coalesce((p_config ->> 'minNoticeHours')::int, 0);
  horizon     int := coalesce((p_config ->> 'bookingHorizonDays')::int, 30);
  days_needed int;
  v_box       text;
  new_row     public.bookings%rowtype;
begin
  if p_service_id is null or p_start is null then
    raise exception 'Не хватает данных: нужны услуга и время';
  end if;
  if length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Укажите имя';
  end if;
  if length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) < 10 then
    raise exception 'Укажите телефон';
  end if;

  perform pg_advisory_xact_lock(hashtext('booking:' || p_slug));

  -- Повтор той же попытки отдаёт уже созданную запись — даже если время
  -- за это время успело пройти (обрыв сети и повтор через минуту).
  if p_request_id is not null then
    select * into existing from public.bookings b
    where b.tenant_slug = p_slug and b.request_id = p_request_id;
    if found then
      return jsonb_build_object(
        'id', existing.id, 'code', existing.code,
        'startUtc', existing.starts_at, 'endUtc', existing.ends_at,
        'serviceName', existing.service_name, 'price', existing.price,
        'boxId', existing.box_id, 'repeated', true
      );
    end if;
  end if;

  -- Прошедшее время. Клиенту — никогда. Владельцу оставляем 15 минут:
  -- клиент уже стоит у бокса, и запись вносят «на сейчас» чуть позже.
  if p_start < now() - (case when p_enforce_rules then interval '0' else interval '15 minutes' end) then
    raise exception 'Нельзя записать на прошедшее время. Выберите другое.';
  end if;

  select s into service
  from jsonb_array_elements(p_config -> 'services') s
  where s ->> 'id' = p_service_id and coalesce((s ->> 'isActive')::boolean, true);
  if service is null then
    raise exception 'Услуга недоступна';
  end if;

  days_needed := greatest(coalesce((service ->> 'days')::int, 1), 1);

  if p_enforce_rules then
    if p_start < now() + make_interval(hours => min_notice) then
      raise exception 'Слишком поздно: запись принимаем минимум за % ч до визита', min_notice;
    end if;
    if p_start > now() + make_interval(days => horizon) then
      raise exception 'Запись открыта только на % дней вперёд', horizon;
    end if;
  end if;

  v_end := public.booking_window(p_config, service, p_start);

  v_box := public.pick_free_box(
    p_slug, p_config, days_needed,
    p_start,
    v_end + make_interval(mins => buffer_min)
  );
  if v_box is null then
    raise exception 'Это время уже занято. Выберите другое';
  end if;

  begin
    insert into public.bookings (
      tenant_slug, code, service_id, service_name, box_id,
      starts_at, ends_at, busy_from, busy_to, status,
      price, contact_name, contact_phone, car, comment, request_id, source
    )
    values (
      p_slug, public.new_booking_code(p_slug), p_service_id, service ->> 'name', v_box,
      p_start, v_end,
      p_start,
      v_end + make_interval(mins => buffer_min),
      case when p_source = 'owner' then 'confirmed'::public.booking_status else 'pending'::public.booking_status end,
      (service ->> 'price')::int,
      left(trim(p_name), 120), left(trim(p_phone), 40),
      left(coalesce(trim(p_car), ''), 120), left(coalesce(trim(p_comment), ''), 1000),
      p_request_id, p_source
    )
    returning * into new_row;
  exception when exclusion_violation then
    raise exception 'Это время только что заняли. Выберите другое';
  end;

  return jsonb_build_object(
    'id', new_row.id, 'code', new_row.code,
    'startUtc', new_row.starts_at, 'endUtc', new_row.ends_at,
    'serviceName', new_row.service_name, 'price', new_row.price,
    'boxId', new_row.box_id, 'repeated', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 1.4  create_booking: лимиты частоты поверх правил 20260103
-- ---------------------------------------------------------------------------

create or replace function public.create_booking(
  p_tenant_slug text,
  p_service_id  text,
  p_start       timestamptz,
  p_name        text,
  p_phone       text,
  p_car         text default null,
  p_comment     text default null,
  p_request_id  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cfg       jsonb;
  v_key       text;
  v_tz        text;
  v_day_start timestamptz;
  v_day_end   timestamptz;
  v_code      text;
  v_at        timestamptz;
  v_upcoming  int;
  v_phone     text;
  v_recent    int;
  v_repeat    boolean;
begin
  v_cfg := public.studio_config(p_tenant_slug);
  if v_cfg is null then
    raise exception 'Студия не найдена или ещё не опубликована';
  end if;

  v_key := right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 10);
  v_phone := coalesce(nullif(v_cfg ->> 'phone', ''), 'студии');

  v_repeat := p_request_id is not null and exists (
    select 1 from public.bookings b
    where b.tenant_slug = p_tenant_slug and b.request_id = p_request_id
  );

  if not v_repeat then
    -- Лимиты частоты. Считаем созданные записи (в том числе отменённые —
    -- иначе «создал-отменил» в цикле обходил бы лимит).
    if length(v_key) = 10 then
      select count(*) into v_recent
      from public.bookings b
      where b.tenant_slug = p_tenant_slug and b.source = 'client'
        and right(b.phone_key, 10) = v_key
        and b.created_at > now() - interval '1 hour';
      if v_recent >= 5 then
        raise exception 'Слишком много записей с этого номера за час. Позвоните в студию: %', v_phone
          using errcode = 'PT429';
      end if;
    end if;

    select count(*) into v_recent
    from public.bookings b
    where b.tenant_slug = p_tenant_slug and b.source = 'client'
      and b.created_at > now() - interval '1 hour';
    if v_recent >= 30 then
      raise exception 'Сейчас слишком много записей. Попробуйте через несколько минут или позвоните: %', v_phone
        using errcode = 'PT429';
    end if;

    -- Лимита по IP на запись нет намеренно: если сайт ходит в базу через
    -- прокси Vercel (/sb), все клиенты приходят с адресов Vercel, и общий
    -- лимит по IP остановил бы настоящие записи.
  end if;

  if length(v_key) = 10 and p_start is not null then
    perform pg_advisory_xact_lock(hashtextextended('booking-phone:' || p_tenant_slug || ':' || v_key, 0));

    -- Проверяем повтор ещё раз уже под замком: параллельный «двойной
    -- клик» мог создать запись, пока мы ждали.
    v_repeat := p_request_id is not null and exists (
      select 1 from public.bookings b
      where b.tenant_slug = p_tenant_slug and b.request_id = p_request_id
    );

    if not v_repeat then
      v_tz := coalesce(nullif(v_cfg ->> 'timezone', ''), 'Europe/Moscow');
      v_day_start := ((p_start at time zone v_tz)::date)::timestamp at time zone v_tz;
      v_day_end := v_day_start + interval '1 day';

      select b.code, b.starts_at into v_code, v_at
      from public.bookings b
      where b.tenant_slug = p_tenant_slug
        and right(b.phone_key, 10) = v_key
        and b.status in ('pending', 'confirmed', 'in_progress')
        and b.starts_at < v_day_end
        and b.ends_at > v_day_start
      order by b.starts_at
      limit 1;

      if found then
        raise exception 'На этот день у вас уже есть запись % на %. Чтобы добавить услугу или изменить время, позвоните в студию: %',
          v_code, to_char(v_at at time zone v_tz, 'HH24:MI'), v_phone;
      end if;

      select count(*) into v_upcoming
      from public.bookings b
      where b.tenant_slug = p_tenant_slug
        and right(b.phone_key, 10) = v_key
        and b.status in ('pending', 'confirmed')
        and b.starts_at > now();

      if v_upcoming >= 3 then
        raise exception 'У вас уже 3 предстоящие записи. Новую можно сделать после визита или по телефону: %', v_phone;
      end if;
    end if;
  end if;

  return public.insert_booking_core(
    p_tenant_slug, v_cfg, p_service_id, p_start, p_name, p_phone,
    p_car, p_comment, p_request_id, 'client', true
  );
end;
$$;

comment on function public.create_booking is
  'Запись клиента: правила студии, один телефон — одна запись на день, не больше 3 предстоящих, лимиты частоты. Повтор с тем же p_request_id возвращает ту же запись.';

-- ---------------------------------------------------------------------------
-- 1.4  cancel_booking: не больше 10 неудачных попыток в час
-- ---------------------------------------------------------------------------

create or replace function public.cancel_booking(
  p_tenant_slug text,
  p_code        text,
  p_phone       text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b          public.bookings%rowtype;
  cfg        jsonb;
  free_hours int;
  v_phone    text := right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 10);
  v_key      text := coalesce(p_tenant_slug, '') || ':' || v_phone;
  v_ip       text := public.request_ip();
begin
  -- Проверяем лимит ДО поиска: после 10 промахов подряд даже верный код
  -- не отвечает час — иначе перебор просто шёл бы медленнее.
  if not public.rate_allow('cancel_fail', v_key, 10, interval '1 hour', false)
     or not public.rate_allow('cancel_fail_ip', v_ip, 30, interval '1 hour', false) then
    raise exception 'Слишком много неудачных попыток отмены. Попробуйте через час или позвоните в студию.'
      using errcode = 'PT429';
  end if;

  select * into b
  from public.bookings
  where tenant_slug = p_tenant_slug
    and code = upper(trim(p_code))
    and phone_key = regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
  for update;

  if not found then
    perform public.rate_allow('cancel_fail', v_key, 1000000, interval '1 hour', true);
    perform public.rate_allow('cancel_fail_ip', v_ip, 1000000, interval '1 hour', true);
    return jsonb_build_object('ok', false, 'reason', 'Запись не найдена: проверьте код и телефон');
  end if;
  if b.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'status', 'cancelled', 'alreadyCancelled', true);
  end if;
  if b.status in ('done', 'in_progress') then
    return jsonb_build_object('ok', false, 'reason', 'Эту запись уже нельзя отменить — позвоните в студию');
  end if;

  cfg := public.studio_config_any(p_tenant_slug);
  free_hours := coalesce((cfg #>> '{cancellation,freeCancelHours}')::int, 0);
  if b.starts_at - now() < make_interval(hours => free_hours) then
    return jsonb_build_object(
      'ok', false,
      'reason', format('Отменить онлайн можно не позже чем за %s ч до визита. Позвоните в студию.', free_hours)
    );
  end if;

  update public.bookings set status = 'cancelled' where id = b.id;
  return jsonb_build_object('ok', true, 'status', 'cancelled', 'alreadyCancelled', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1.4  my_bookings: лимит запросов (перебор номеров)
-- ---------------------------------------------------------------------------

-- Было language sql stable. Теперь пишет счётчик, поэтому volatile:
-- supabase-js вызывает rpc POST-запросом, это работает. GET-вызов
-- (rpc(..., {get: true})) volatile-функция не примет.
create or replace function public.my_bookings(p_tenant_slug text, p_phone text)
returns table (
  id             uuid,
  code           text,
  tenant_slug    text,
  service_id     text,
  service_name   text,
  starts_at      timestamptz,
  ends_at        timestamptz,
  status         public.booking_status,
  price          integer,
  contact_name   text,
  contact_phone  text,
  car            text,
  created_at     timestamptz
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  -- С одного IP — 60 запросов за 10 минут, на один номер — 20 в час.
  -- Экран «Мои записи» делает один-два запроса. Лимит по IP щедрый: через
  -- прокси /sb много клиентов делят адреса Vercel.
  if not public.rate_allow('my_bookings_ip', public.request_ip(), 60, interval '10 minutes')
     or not public.rate_allow('my_bookings_phone', coalesce(p_tenant_slug, '') || ':' || v_phone, 20, interval '1 hour') then
    raise exception 'Слишком много запросов. Попробуйте через несколько минут.' using errcode = 'PT429';
  end if;

  return query
  select b.id, b.code, b.tenant_slug, b.service_id, b.service_name,
         b.starts_at, b.ends_at, b.status, b.price,
         b.contact_name, b.contact_phone, b.car, b.created_at
  from public.bookings b
  where b.tenant_slug = p_tenant_slug
    and b.phone_key = v_phone
    and b.status in ('pending', 'confirmed', 'in_progress')
  order by b.starts_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1.6  Перенос владельцем: тоже не в прошлое
-- ---------------------------------------------------------------------------

create or replace function public.owner_reschedule_booking(p_booking_id uuid, p_start timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b          public.bookings%rowtype;
  cfg        jsonb;
  service    jsonb;
  v_end      timestamptz;
  buffer_min int;
  v_box      text;
begin
  select * into b from public.bookings where id = p_booking_id;
  if not found then
    raise exception 'Запись не найдена';
  end if;
  if not public.can_manage_tenant(b.tenant_slug) then
    raise exception 'Нет доступа к записи' using errcode = '42501';
  end if;
  if b.status in ('done', 'cancelled') then
    raise exception 'Завершённую или отменённую запись перенести нельзя';
  end if;
  if p_start is null or p_start < now() - interval '15 minutes' then
    raise exception 'Нельзя записать на прошедшее время. Выберите другое.';
  end if;

  perform pg_advisory_xact_lock(hashtext('booking:' || b.tenant_slug));

  cfg := public.studio_config_any(b.tenant_slug);
  buffer_min := coalesce((cfg ->> 'bufferMin')::int, 0);
  select s into service from jsonb_array_elements(cfg -> 'services') s where s ->> 'id' = b.service_id;
  if service is null then
    service := jsonb_build_object(
      'durationMin', greatest(extract(epoch from (b.ends_at - b.starts_at))::int / 60, 15),
      'days', 1
    );
  end if;

  v_end := public.booking_window(cfg, service, p_start);
  v_box := public.pick_free_box(
    b.tenant_slug, cfg, greatest(coalesce((service ->> 'days')::int, 1), 1),
    p_start,
    v_end + make_interval(mins => buffer_min),
    b.id, b.box_id
  );
  if v_box is null then
    raise exception 'На это время все боксы заняты';
  end if;

  begin
    update public.bookings
    set starts_at = p_start,
        ends_at = v_end,
        busy_from = p_start,
        busy_to = v_end + make_interval(mins => buffer_min),
        box_id = v_box
    where id = b.id;
  exception when exclusion_violation then
    raise exception 'Это время только что заняли';
  end;

  return jsonb_build_object('ok', true, 'id', b.id, 'startUtc', p_start, 'endUtc', v_end, 'boxId', v_box);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1.5  SECURITY DEFINER: search_path и права
-- ---------------------------------------------------------------------------

-- Без pg_temp в конце Postgres ищет таблицы во временной схеме ПЕРВОЙ —
-- то есть «set search_path = public» не защищает от подмены таблицы
-- временной с тем же именем. Явный pg_temp в конце закрывает это.
-- new_booking_code сохраняет extensions (там gen_random_bytes на Supabase).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    if r.proname = 'new_booking_code' then
      execute format('alter function %s set search_path = public, extensions, pg_temp', r.sig);
    else
      execute format('alter function %s set search_path = public, pg_temp', r.sig);
    end if;
  end loop;
end;
$$;

-- Права на функции: всё закрыть и открыть явно (как в 20260102), потому
-- что функции, созданные после той миграции, получили EXECUTE для PUBLIC.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end;
$$;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- Публичные (посетитель сайта). studio_config сюда больше не входит:
-- полный конфиг посетителю не нужен, сайт читает только studio_patch.
grant execute on function public.studio_patch(text)                  to anon, authenticated;
grant execute on function public.studio_busy(text)                   to anon, authenticated;
grant execute on function public.studio_free_slots(text, text, timestamptz, timestamptz, int) to anon, authenticated;
grant execute on function public.create_booking(text, text, timestamptz, text, text, text, text, uuid) to anon, authenticated;
grant execute on function public.my_bookings(text, text)             to anon, authenticated;
grant execute on function public.cancel_booking(text, text, text)    to anon, authenticated;
grant execute on function public.subscribe_reminder(text, text, text, jsonb) to anon, authenticated;

-- Нужны политикам RLS и внутренним вызовам под ролью пользователя.
grant execute on function public.is_tenant_owner(text)               to anon, authenticated;
grant execute on function public.is_tenant_staff(text)               to anon, authenticated;
grant execute on function public.can_manage_tenant(text)             to authenticated;
grant execute on function public.hhmm_to_min(text)                   to anon, authenticated;
grant execute on function public.studio_hours_for(jsonb, date)       to anon, authenticated;
grant execute on function public.studio_day_start(text, date)        to anon, authenticated;
grant execute on function public.booking_window(jsonb, jsonb, timestamptz) to anon, authenticated;
grant execute on function public.touch_updated_at()                  to anon, authenticated;
grant execute on function public.request_ip()                        to anon, authenticated;

-- Кабинет (проверка привязки пользователя к студии внутри каждой функции:
-- can_manage_tenant / is_tenant_owner по tenant_members и auth.uid()).
grant execute on function public.my_studios()                                        to authenticated;
grant execute on function public.owner_bookings(text, timestamptz, timestamptz)      to authenticated;
grant execute on function public.owner_stats(text, timestamptz, timestamptz)         to authenticated;
grant execute on function public.owner_payments(text, timestamptz, timestamptz)      to authenticated;
grant execute on function public.owner_create_booking(text, text, timestamptz, text, text, text, text, uuid) to authenticated;
grant execute on function public.owner_reschedule_booking(uuid, timestamptz)         to authenticated;
grant execute on function public.owner_set_status(uuid, public.booking_status)       to authenticated;
grant execute on function public.owner_add_payment(uuid, text, integer, text, text)  to authenticated;
grant execute on function public.owner_save_settings(text, jsonb)                    to authenticated;
grant execute on function public.studio_today(text)                                  to authenticated;
grant execute on function public.studio_bookings(text, timestamptz, timestamptz)     to authenticated;
