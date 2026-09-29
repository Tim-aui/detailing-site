-- Запись: создание, отмена, «мои записи».
--
-- Клиент не может создать запись обычным INSERT: таблица закрыта RLS,
-- а функция ниже делает то, чего не сделает клиент, — проверяет занятость
-- и записывает всё в одной транзакции. Ограничение bookings_no_overlap
-- остаётся последним рубежом: даже если два запроса прошли проверку
-- одновременно, база не даст им занять один бокс.

-- ---------------------------------------------------------------------------
-- Чтение настроек
-- ---------------------------------------------------------------------------

-- Настройки студии целиком: файл из tenants.config, поверх — правки владельца.
create or replace function public.studio_config(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select t.config || coalesce(s.patch, '{}'::jsonb)
  from public.tenants t
  left join public.tenant_settings s on s.tenant_slug = t.slug
  where t.slug = p_slug and t.is_published;
$$;

comment on function public.studio_config(text) is
  'Настройки студии с учётом правок владельца. SECURITY DEFINER: черновики и правки не должны быть видны всем.';

-- Часы работы на конкретную дату студии. Возвращает пусто, если день выходной.
create or replace function public.studio_hours_for(p_config jsonb, p_local_date date)
returns jsonb
language sql
immutable
as $$
  select coalesce(
    (
      select h
      from jsonb_array_elements(p_config -> 'hours') h
      where (h ->> 'day')::int = extract(dow from p_local_date)::int
      limit 1
    ),
    '{}'::jsonb
  );
$$;

-- Время работы в виде минут от полуночи для сравнения без строк.
create or replace function public.hhmm_to_min(p_time text)
returns int
language sql
immutable
as $$
  select case
    when p_time is null or p_time = '' then null
    else split_part(p_time, ':', 1)::int * 60 + split_part(p_time, ':', 2)::int
  end;
$$;

-- ---------------------------------------------------------------------------
-- Создание записи
-- ---------------------------------------------------------------------------

create or replace function public.create_booking(
  p_tenant_slug text,
  p_service_id  text,
  p_start       timestamptz,
  p_name        text,
  p_phone       text,
  p_car         text default null,
  p_comment     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg           jsonb;
  service       jsonb;
  tz            text;
  boxes         jsonb;
  box           jsonb;
  chosen_box    text;
  duration_min  int;
  days_needed   int;
  buffer_min    int;
  min_notice_h  int;
  horizon_days  int;
  ends_at       timestamptz;
  busy_from     timestamptz;
  busy_to       timestamptz;
  notice_ok_at  timestamptz;
  horizon_ok_at timestamptz;
  day_open      int;
  day_close     int;
  local_start   timestamp;
  local_end     timestamp;
  k             int;
  cur_day       date;
  cur_hours     jsonb;
  new_code      text;
  new_id        uuid;
  attempts      int := 0;
begin
  if p_tenant_slug is null or p_service_id is null or p_start is null then
    raise exception 'Не хватает данных: нужны студия, услуга и время';
  end if;

  if length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Укажите имя';
  end if;

  if length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) < 10 then
    raise exception 'Укажите телефон';
  end if;

  cfg := public.studio_config(p_tenant_slug);
  if cfg is null then
    raise exception 'Студия не найдена или ещё не опубликована';
  end if;

  -- Услуга ищем сами: клиент присылает id, но цену и длительность
  -- берём из настроек, иначе можно записаться по любой цене.
  select s into service
  from jsonb_array_elements(cfg -> 'services') s
  where s ->> 'id' = p_service_id and coalesce((s ->> 'isActive')::boolean, true);

  if service is null then
    raise exception 'Услуга недоступна';
  end if;

  tz := cfg ->> 'timezone';
  duration_min := (service ->> 'durationMin')::int;
  days_needed := greatest((service ->> 'days')::int, 1);
  buffer_min := coalesce((cfg ->> 'bufferMin')::int, 0);
  min_notice_h := coalesce((cfg ->> 'minNoticeHours')::int, 0);
  horizon_days := coalesce((cfg ->> 'bookingHorizonDays')::int, 30);

  -- Границы записи: конец считаем сами, клиенту не доверяем.
  ends_at := p_start + make_interval(mins => duration_min);
  if ends_at <= p_start then
    raise exception 'Некорректное время';
  end if;

  notice_ok_at := now() + make_interval(hours => min_notice_h);
  if p_start < notice_ok_at then
    raise exception 'Слишком поздно: запись принимаем минимум за % час(а) до визита', min_notice_h;
  end if;

  horizon_ok_at := now() + make_interval(days => horizon_days);
  if p_start > horizon_ok_at then
    raise exception 'Запись открыта только на % дней вперёд', horizon_days;
  end if;

  -- Проверяем часы работы по каждому дню: многодневная работа должна
  -- целиком попадать в рабочие дни, а не начинаться в выходной.
  local_start := p_start at time zone tz;
  for k in 0..days_needed - 1 loop
    cur_day := (local_start + make_interval(days => k))::date;
    cur_hours := public.studio_hours_for(cfg, cur_day);
    day_open := public.hhmm_to_min(cur_hours ->> 'open');
    day_close := public.hhmm_to_min(cur_hours ->> 'close');

    if day_open is null or day_close is null then
      raise exception 'Студия закрыта в выбранный день (%s)', to_char(cur_day, 'DD.MM.YYYY');
    end if;

    if k = 0 and extract(hour from local_start) * 60 + extract(minute from local_start) < day_open then
      raise exception 'Студия открывается в %s', cur_hours ->> 'open';
    end if;

    -- Последний день: работа обязана закончиться до закрытия.
    if k = days_needed - 1 then
      local_end := ends_at at time zone tz;
      if (local_end)::date <> cur_day or extract(hour from local_end) * 60 + extract(minute from local_end) > day_close then
        raise exception 'Работа не помещается до закрытия (%s)', cur_hours ->> 'close';
      end if;
    end if;
  end loop;

  -- Блокируем параллельные записи этой студии: без этого два человека
  -- в один момент выберут один слот и один из них получит ошибку
  -- вместо подтверждения.
  perform pg_advisory_xact_lock(hashtext(p_tenant_slug));

  boxes := cfg -> 'boxes';
  for box in select * from jsonb_array_elements(boxes) order by box ->> 'id' loop
    attempts := attempts + 1;
    if not coalesce((box ->> 'isActive')::boolean, true) then
      continue;
    end if;
    if days_needed > 1 and not coalesce((box ->> 'acceptsLongStay')::boolean, true) then
      continue;
    end if;

    busy_from := p_start - make_interval(mins => buffer_min);
    busy_to := ends_at + make_interval(mins => buffer_min);

    -- Код записи: короткий, без похожих символов (0/O, 1/I).
    new_code := upper(substr(translate(gen_random_uuid()::text, 'aeiou01', 'AEIOU-Z'), 1, 4));
    if exists (select 1 from public.bookings b where b.tenant_slug = p_tenant_slug and b.code = new_code) then
      new_code := new_code || substr(gen_random_uuid()::text, 1, 1);
    end if;

    begin
      insert into public.bookings (
        tenant_slug, code, service_id, service_name, box_id,
        starts_at, ends_at, busy_from, busy_to,
        price, contact_name, contact_phone, car, comment
      )
      values (
        p_tenant_slug, new_code, p_service_id, service ->> 'name', box ->> 'id',
        p_start, ends_at, busy_from, busy_to,
        (service ->> 'price')::int,
        trim(p_name), trim(p_phone), coalesce(p_car, ''), coalesce(p_comment, '')
      )
      returning id into new_id;

      chosen_box := box ->> 'id';
      exit;
    exception when exclusion_violation then
      -- Бокс занят — пробуем следующий. Если кончились, сообщаем клиенту.
      new_code := null;
    end;
  end loop;

  if chosen_box is null then
    if attempts = 0 then
      raise exception 'В студии нет свободных боксов';
    end if;
    raise exception 'Это время только что заняли. Выберите другое';
  end if;

  return jsonb_build_object(
    'id', new_id,
    'code', new_code,
    'startUtc', p_start,
    'endUtc', ends_at,
    'serviceName', service ->> 'name',
    'price', (service ->> 'price')::int
  );
end;
$$;

comment on function public.create_booking is
  'Создаёт запись и занимает бокс. SECURITY DEFINER: клиент не имеет прямого доступа к bookings.';

-- ---------------------------------------------------------------------------
-- Мои записи
-- ---------------------------------------------------------------------------

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
language sql
security definer
set search_path = public
as $$
  select b.id, b.code, b.tenant_slug, b.service_id, b.service_name,
         b.starts_at, b.ends_at, b.status, b.price,
         b.contact_name, b.contact_phone, b.car, b.created_at
  from public.bookings b
  where b.tenant_slug = p_tenant_slug
    and b.phone_key = regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
    and b.status in ('pending', 'confirmed', 'in_progress')
  order by b.starts_at;
$$;

comment on function public.my_bookings(text, text) is
  'Записи по номеру телефона. Компромисс безаккаунтной записи: знающий номер видит запись — как в YCLIENTS.';

-- ---------------------------------------------------------------------------
-- Отмена
-- ---------------------------------------------------------------------------

create or replace function public.cancel_booking(
  p_tenant_slug text,
  p_code        text,
  p_phone       text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b            public.bookings%rowtype;
  cfg          jsonb;
  free_hours   int;
begin
  select * into b
  from public.bookings
  where tenant_slug = p_tenant_slug
    and code = upper(trim(p_code))
    and phone_key = regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'Запись не найдена: проверьте код и телефон');
  end if;

  -- Повторная отмена не должна пугать человека ошибкой.
  if b.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'status', 'cancelled', 'alreadyCancelled', true);
  end if;

  if b.status in ('done', 'in_progress') then
    return jsonb_build_object('ok', false, 'reason', 'Эту запись уже нельзя отменить — позвоните в студию');
  end if;

  -- Поздняя отмена не отменяется, а требует звонка: иначе студия теряет
  -- место в последний момент.
  cfg := public.studio_config(p_tenant_slug);
  free_hours := coalesce((cfg #>> '{cancellation,freeCancelHours}')::int, 0);
  if b.starts_at - now() < make_interval(hours => free_hours) then
    return jsonb_build_object(
      'ok', false,
      'reason', format('Без штрафа отменить можно за %s часов до визита. Позвоните в студию.', free_hours)
    );
  end if;

  update public.bookings set status = 'cancelled' where b.id = b.id;
  return jsonb_build_object('ok', true, 'status', 'cancelled', 'alreadyCancelled', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Кабинет владельца
-- ---------------------------------------------------------------------------

-- Записи студии на период: только владелец или мастер.
create or replace function public.studio_bookings(
  p_tenant_slug text,
  p_from        timestamptz default null,
  p_to          timestamptz default null
)
returns table (
  id            uuid,
  code          text,
  service_name  text,
  starts_at     timestamptz,
  ends_at       timestamptz,
  status        public.booking_status,
  price         integer,
  contact_name  text,
  contact_phone text,
  car           text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_tenant_owner(p_tenant_slug) or public.is_tenant_staff(p_tenant_slug)) then
    raise exception 'Нет доступа к записям этой студии';
  end if;

  return query
  select b.id, b.code, b.service_name, b.starts_at, b.ends_at, b.status, b.price,
         b.contact_name, b.contact_phone, b.car
  from public.bookings b
  where b.tenant_slug = p_tenant_slug
    and (p_from is null or b.starts_at >= p_from)
    and (p_to   is null or b.starts_at <  p_to)
  order by b.starts_at
  limit 500;
end;
$$;

-- Подтверждение, начало и завершение работы — только владелец/мастер.
create or replace function public.set_booking_status(
  p_code   text,
  p_status public.booking_status
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings%rowtype;
begin
  select * into b from public.bookings where code = upper(trim(p_code));
  if not found then
    raise exception 'Запись не найдена';
  end if;

  if not (public.is_tenant_owner(b.tenant_slug) or public.is_tenant_staff(b.tenant_slug)) then
    raise exception 'Нет доступа к записи';
  end if;

  if p_status not in ('confirmed', 'in_progress', 'done', 'cancelled') then
    raise exception 'Недопустимый статус';
  end if;

  update public.bookings set status = p_status where id = b.id;
  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

-- Сводка на сегодня для главной экрана кабинета.
create or replace function public.studio_today(p_tenant_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg     jsonb;
  tz      text;
  d_start timestamptz;
  d_end   timestamptz;
begin
  if not (public.is_tenant_owner(p_tenant_slug) or public.is_tenant_staff(p_tenant_slug)) then
    raise exception 'Нет доступа';
  end if;

  cfg := public.studio_config(p_tenant_slug);
  tz := coalesce(cfg ->> 'timezone', 'Europe/Moscow');
  d_start := (now() at time zone tz)::date::timestamptz at time zone tz;
  d_end := d_start + interval '1 day';

  return jsonb_build_object(
    'date', to_char(now() at time zone tz, 'YYYY-MM-DD'),
    'timezone', tz,
    'total', (select count(*) from public.bookings b
              where b.tenant_slug = p_tenant_slug and b.starts_at >= d_start
                and b.starts_at < d_end and b.status <> 'cancelled'),
    'pending', (select count(*) from public.bookings b
                where b.tenant_slug = p_tenant_slug and b.starts_at >= d_start
                  and b.starts_at < d_end and b.status = 'pending'),
    'done', (select count(*) from public.bookings b
             where b.tenant_slug = p_tenant_slug and b.starts_at >= d_start
               and b.starts_at < d_end and b.status = 'done')
  );
end;
$$;
