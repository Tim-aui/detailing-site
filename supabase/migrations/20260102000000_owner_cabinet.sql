-- Кабинет владельца, оплаты, исправления записи и права.
--
-- Что чинит эта миграция (найдено при сверке с ТЗ):
--   • bookings_no_overlap сравнивал только box_id — бокс «box-1» одной
--     студии блокировал «box-1» другой. Теперь в ограничении есть студия.
--   • cancel_booking отменял ВСЕ записи базы (where b.id = b.id).
--   • create_booking: многодневная работа не занимала следующие дни и
--     всегда падала на проверке последнего дня; двойной клик создавал
--     две записи.
--   • next_free_slots не видел записей под anon (не SECURITY DEFINER) и
--     игнорировал p_limit.
--   • set_booking_status искал запись по коду во всех студиях сразу.
--   • Владелец мог напрямую писать в tenants (сам себя опубликовать) и в
--     tenant_settings мимо списка разрешённых ключей.
--   • Служебные функции помощника можно было вызвать анонимно.
--
-- Что добавляет:
--   • payments — оплаты и возвраты (реально полученные деньги).
--   • RPC кабинета: записи за период, сводка, ручная запись, перенос,
--     статусы, оплата/возврат, сохранение настроек с проверкой.
--   • studio_busy — занятость без личных данных для экрана записи.
--   • closedDates — отдельные нерабочие даты (праздники, отпуск).
--   • Хранилище studio-media для фото владельца.
--   • Учёт токенов помощника и дневной бюджет.

-- ---------------------------------------------------------------------------
-- 1. Изоляция студий в ограничении пересечений
-- ---------------------------------------------------------------------------

alter table public.bookings drop constraint if exists bookings_no_overlap;
alter table public.bookings add constraint bookings_no_overlap exclude using gist (
  tenant_slug with =,
  box_id      with =,
  tstzrange(busy_from, busy_to) with &&
) where (status in ('pending', 'confirmed', 'in_progress'));

comment on constraint bookings_no_overlap on public.bookings is
  'Один бокс одной студии не может быть занят двумя активными записями одновременно.';

-- Буфер теперь только после работы (см. pick_free_box). Сужение
-- интервалов не может создать пересечений, поэтому безопасно.
update public.bookings set busy_from = starts_at where busy_from <> starts_at;

-- ---------------------------------------------------------------------------
-- 2. Повторная отправка и источник записи
-- ---------------------------------------------------------------------------

-- request_id генерирует экран записи один раз на попытку. Повторный запрос
-- с тем же id (двойной клик, повтор после обрыва сети) вернёт ту же запись.
alter table public.bookings add column if not exists request_id uuid;
alter table public.bookings add column if not exists source text not null default 'client';
do $$
begin
  alter table public.bookings add constraint bookings_source_check check (source in ('client', 'owner'));
exception when duplicate_object then null;
end;
$$;
create unique index if not exists bookings_request_idx
  on public.bookings (tenant_slug, request_id) where request_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Оплаты и возвраты
-- ---------------------------------------------------------------------------

create table if not exists public.payments (
  id          uuid primary key default gen_random_uuid(),
  tenant_slug text        not null references public.tenants(slug) on delete cascade,
  booking_id  uuid        references public.bookings(id) on delete set null,
  kind        text        not null check (kind in ('payment', 'refund')),
  -- Копейки, всегда положительное число; знак задаёт kind.
  amount      integer     not null check (amount > 0),
  method      text        not null default 'cash' check (method in ('cash', 'card', 'transfer', 'other')),
  note        text        not null default '',
  created_at  timestamptz not null default now(),
  created_by  uuid        references auth.users(id) on delete set null
);

create index if not exists payments_tenant_created_idx on public.payments (tenant_slug, created_at);
create index if not exists payments_booking_idx on public.payments (booking_id);

alter table public.payments enable row level security;

drop policy if exists payments_staff_read on public.payments;
create policy payments_staff_read on public.payments
  for select
  using (public.is_tenant_owner(tenant_slug) or public.is_tenant_staff(tenant_slug));
-- Вставка — только через owner_add_payment: там проверка суммы возврата.

-- ---------------------------------------------------------------------------
-- 4. Права на прямую запись в настройки
-- ---------------------------------------------------------------------------

-- Публикует студию только скрипт tenant:push (service_role) после проверки.
drop policy if exists tenants_owner_write on public.tenants;
-- Правки владельца — только через owner_save_settings (белый список ключей
-- и проверка формата). Прямой upsert обходил бы и то и другое.
drop policy if exists tenant_settings_owner_write on public.tenant_settings;

-- ---------------------------------------------------------------------------
-- 5. Помощник: учёт токенов
-- ---------------------------------------------------------------------------

alter table public.assistant_usage add column if not exists mode text not null default 'client';
alter table public.assistant_usage add column if not exists tokens integer not null default 0;
create index if not exists assistant_usage_day_idx on public.assistant_usage (created_at);

-- ---------------------------------------------------------------------------
-- 6. Общие помощники
-- ---------------------------------------------------------------------------

-- Настройки без проверки публикации — для кабинета и внутренних функций.
create or replace function public.studio_config_any(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select t.config || coalesce(s.patch, '{}'::jsonb)
  from public.tenants t
  left join public.tenant_settings s on s.tenant_slug = t.slug
  where t.slug = p_slug;
$$;

-- Нерабочие даты (closedDates) закрывают день поверх недельного графика.
create or replace function public.studio_hours_for(p_config jsonb, p_local_date date)
returns jsonb
language sql
immutable
as $$
  select case
    when coalesce(p_config -> 'closedDates', '[]'::jsonb) ? to_char(p_local_date, 'YYYY-MM-DD') then '{}'::jsonb
    else coalesce(
      (
        select h
        from jsonb_array_elements(p_config -> 'hours') h
        where (h ->> 'day')::int = extract(dow from p_local_date)::int
        limit 1
      ),
      '{}'::jsonb
    )
  end;
$$;

create or replace function public.can_manage_tenant(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_tenant_owner(p_slug) or public.is_tenant_staff(p_slug);
$$;

-- Полночь даты студии в UTC. В studio_today это считалось в поясе сессии.
create or replace function public.studio_day_start(p_tz text, p_day date)
returns timestamptz
language sql
immutable
as $$
  select (p_day::timestamp) at time zone p_tz;
$$;

-- Окно записи: проверяет рабочие часы каждого дня и возвращает конец.
-- Многодневная работа держит бокс до закрытия последнего дня — ровно
-- как bookingEnd() на клиенте, иначе клиент и сервер разойдутся.
create or replace function public.booking_window(p_config jsonb, p_service jsonb, p_start timestamptz)
returns timestamptz
language plpgsql
stable
as $$
declare
  tz           text := coalesce(p_config ->> 'timezone', 'Europe/Moscow');
  duration_min int := (p_service ->> 'durationMin')::int;
  days_needed  int := greatest(coalesce((p_service ->> 'days')::int, 1), 1);
  local_start  timestamp := p_start at time zone tz;
  start_min    int := extract(hour from (p_start at time zone tz))::int * 60 + extract(minute from (p_start at time zone tz))::int;
  first_day    date := (p_start at time zone tz)::date;
  cur_day      date;
  cur_hours    jsonb;
  day_open     int;
  day_close    int;
  ends_at      timestamptz;
  k            int;
begin
  if duration_min is null or duration_min <= 0 then
    raise exception 'У услуги не задана длительность';
  end if;

  for k in 0..days_needed - 1 loop
    cur_day := first_day + k;
    cur_hours := public.studio_hours_for(p_config, cur_day);
    day_open := public.hhmm_to_min(cur_hours ->> 'open');
    day_close := public.hhmm_to_min(cur_hours ->> 'close');
    if day_open is null or day_close is null then
      raise exception 'Студия закрыта % — работа на % дн. туда не помещается', to_char(cur_day, 'DD.MM.YYYY'), days_needed;
    end if;

    if k = 0 then
      if start_min < day_open then
        raise exception 'Студия открывается в %', cur_hours ->> 'open';
      end if;
      if start_min >= day_close then
        raise exception 'Студия уже закрыта в это время (до %)', cur_hours ->> 'close';
      end if;
    end if;

    if k = days_needed - 1 then
      if days_needed = 1 then
        ends_at := p_start + make_interval(mins => duration_min);
        if start_min + duration_min > day_close then
          raise exception 'Работа не помещается до закрытия (%)', cur_hours ->> 'close';
        end if;
      else
        ends_at := (cur_day::timestamp + make_interval(mins => day_close)) at time zone tz;
      end if;
    end if;
  end loop;

  return ends_at;
end;
$$;

-- Первый свободный бокс для интервала. Явная проверка + ограничение
-- bookings_no_overlap как последний рубеж.
--
-- Занятость бокса = [начало, конец + буфер]. Буфер только после работы:
-- при паддинге с двух сторон (как было) между машинами выходило 2×буфер,
-- а экран записи считал 1×буфер и предлагал окна, которые сервер отвергал.
create or replace function public.pick_free_box(
  p_slug       text,
  p_config     jsonb,
  p_days       int,
  p_busy_from  timestamptz,
  p_busy_to    timestamptz,
  p_exclude_id uuid default null,
  p_prefer_box text default null
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select b ->> 'id'
  from jsonb_array_elements(p_config -> 'boxes') b
  where coalesce((b ->> 'isActive')::boolean, true)
    and (p_days <= 1 or coalesce((b ->> 'acceptsLongStay')::boolean, true))
    and not exists (
      select 1 from public.bookings bk
      where bk.tenant_slug = p_slug
        and bk.box_id = b ->> 'id'
        and bk.status in ('pending', 'confirmed', 'in_progress')
        and (p_exclude_id is null or bk.id <> p_exclude_id)
        and tstzrange(bk.busy_from, bk.busy_to) && tstzrange(p_busy_from, p_busy_to)
    )
  order by (b ->> 'id') = coalesce(p_prefer_box, '') desc, b ->> 'id'
  limit 1;
$$;

-- Короткий код без похожих символов, уникальный в пределах студии.
create or replace function public.new_booking_code(p_slug text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code   text;
  i        int;
  tries    int := 0;
begin
  loop
    v_code := '';
    for i in 1..(4 + tries / 5) loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.bookings b where b.tenant_slug = p_slug and b.code = v_code);
    tries := tries + 1;
  end loop;
  return v_code;
end;
$$;

-- Общее ядро записи для клиента и владельца.
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
set search_path = public
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

  -- Один замок на студию: параллельные записи выстраиваются в очередь,
  -- и второй запрос видит уже сохранённую первую запись.
  perform pg_advisory_xact_lock(hashtext('booking:' || p_slug));

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

  -- Цена и длительность — из настроек, а не от клиента.
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
-- 7. Клиентские функции
-- ---------------------------------------------------------------------------

drop function if exists public.create_booking(text, text, timestamptz, text, text, text, text);

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
set search_path = public
as $$
declare
  cfg jsonb;
begin
  cfg := public.studio_config(p_tenant_slug);
  if cfg is null then
    raise exception 'Студия не найдена или ещё не опубликована';
  end if;
  return public.insert_booking_core(
    p_tenant_slug, cfg, p_service_id, p_start, p_name, p_phone,
    p_car, p_comment, p_request_id, 'client', true
  );
end;
$$;

comment on function public.create_booking is
  'Атомарная запись клиента. Повтор с тем же p_request_id возвращает ту же запись.';

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
  b          public.bookings%rowtype;
  cfg        jsonb;
  free_hours int;
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

  -- Раньше здесь было where b.id = b.id — условие всегда истинно,
  -- и отмена одной записи отменяла все записи всех студий.
  update public.bookings set status = 'cancelled' where id = b.id;
  return jsonb_build_object('ok', true, 'status', 'cancelled', 'alreadyCancelled', false);
end;
$$;

-- Занятость для экрана записи: только интервалы и бокс, без имён и
-- телефонов. Нужна потому, что таблица bookings закрыта RLS и прямой
-- select из браузера всегда возвращал пусто.
create or replace function public.studio_busy(p_tenant_slug text)
returns table (box_id text, starts_at timestamptz, ends_at timestamptz, status public.booking_status)
language sql
stable
security definer
set search_path = public
as $$
  select b.box_id, b.starts_at, b.ends_at, b.status
  from public.bookings b
  join public.tenants t on t.slug = b.tenant_slug and t.is_published
  where b.tenant_slug = p_tenant_slug
    and b.status in ('pending', 'confirmed', 'in_progress')
    and b.ends_at > now() - interval '1 day'
    and b.starts_at < now() + make_interval(days => coalesce((t.config ->> 'bookingHorizonDays')::int, 30) + 14)
  order by b.starts_at
  limit 2000;
$$;

-- Свободные окна: тот же расчёт, что и при записи (booking_window +
-- pick_free_box), поэтому помощник не предложит окно, которое сервер
-- потом отвергнет.
drop function if exists public.next_free_slots(text, text, timestamptz, timestamptz, int);

create or replace function public.next_free_slots(
  p_tenant_slug text,
  p_service_id  text,
  p_from        timestamptz,
  p_to          timestamptz,
  p_limit       int default 12
)
returns table (start_at timestamptz, end_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cfg          jsonb;
  tz           text;
  service      jsonb;
  duration_min int;
  days_needed  int;
  buffer_min   int;
  earliest     timestamptz;
  d            date;
  open_min     int;
  close_min    int;
  last_min     int;
  m            int;
  slot_start   timestamptz;
  slot_end     timestamptz;
  n            int := 0;
begin
  cfg := public.studio_config(p_tenant_slug);
  if cfg is null then
    return;
  end if;

  select s into service
  from jsonb_array_elements(cfg -> 'services') s
  where s ->> 'id' = p_service_id and coalesce((s ->> 'isActive')::boolean, true);
  if service is null then
    return;
  end if;

  tz := coalesce(cfg ->> 'timezone', 'Europe/Moscow');
  duration_min := (service ->> 'durationMin')::int;
  days_needed := greatest(coalesce((service ->> 'days')::int, 1), 1);
  buffer_min := coalesce((cfg ->> 'bufferMin')::int, 0);
  earliest := greatest(p_from, now() + make_interval(hours => coalesce((cfg ->> 'minNoticeHours')::int, 0)));

  if duration_min is null or duration_min <= 0 or p_to <= earliest then
    return;
  end if;

  for d in
    select generate_series((earliest at time zone tz)::date, (p_to at time zone tz)::date, interval '1 day')::date
  loop
    open_min  := public.hhmm_to_min(public.studio_hours_for(cfg, d) ->> 'open');
    close_min := public.hhmm_to_min(public.studio_hours_for(cfg, d) ->> 'close');
    continue when open_min is null or close_min is null;

    last_min := case when days_needed > 1 then close_min - 30 else close_min - duration_min end;
    continue when last_min < open_min;

    for m in 0..(last_min - open_min) by 30 loop
      slot_start := (d::timestamp + make_interval(mins => open_min + m)) at time zone tz;
      continue when slot_start < earliest or slot_start > p_to;

      begin
        slot_end := public.booking_window(cfg, service, slot_start);
      exception when others then
        continue; -- следующий день выходной и т. п.
      end;

      if public.pick_free_box(
        p_tenant_slug, cfg, days_needed,
        slot_start,
        slot_end + make_interval(mins => buffer_min)
      ) is not null then
        start_at := slot_start;
        end_at := slot_end;
        return next;
        n := n + 1;
        if n >= greatest(coalesce(p_limit, 12), 1) then
          return;
        end if;
      end if;
    end loop;
  end loop;
end;
$$;

-- Обёртка для браузера: next_free_slots закрыт от anon, а эта функция
-- отдаёт только время окон.
alter function public.studio_free_slots(text, text, timestamptz, timestamptz, int)
  security definer set search_path = public;

-- ---------------------------------------------------------------------------
-- 8. Кабинет владельца
-- ---------------------------------------------------------------------------

-- Студии текущего пользователя: кабинет решает, куда пустить после входа.
create or replace function public.my_studios()
returns table (slug text, name text, role text, is_published boolean)
language sql
stable
security definer
set search_path = public
as $$
  select t.slug, coalesce(public.studio_config_any(t.slug) ->> 'name', t.name), m.role, t.is_published
  from public.tenant_members m
  join public.tenants t on t.slug = m.tenant_slug
  where m.user_id = auth.uid()
  union
  select t.slug, coalesce(public.studio_config_any(t.slug) ->> 'name', t.name), 'staff', t.is_published
  from public.staff_members s
  join public.tenants t on t.slug = s.tenant_slug
  where s.user_id = auth.uid();
$$;

create or replace function public.owner_bookings(
  p_tenant_slug text,
  p_from        timestamptz,
  p_to          timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_manage_tenant(p_tenant_slug) then
    raise exception 'Нет доступа к записям этой студии' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.starts_at)
    from (
      select b.id, b.code, b.service_id, b.service_name, b.box_id,
             b.starts_at, b.ends_at, b.status, b.price, b.source,
             b.contact_name, b.contact_phone, b.car, b.comment, b.created_at,
             coalesce((select sum(case when p.kind = 'payment' then p.amount else -p.amount end)
                       from public.payments p where p.booking_id = b.id), 0)::int as paid
      from public.bookings b
      where b.tenant_slug = p_tenant_slug
        -- Пересечение с периодом, а не только начало: двухдневная работа
        -- видна и во второй день.
        and b.starts_at < p_to
        and b.ends_at > p_from
      order by b.starts_at
      limit 1000
    ) x
  ), '[]'::jsonb);
end;
$$;

-- Сводка за период: заезды, выполнено, реально получено денег.
create or replace function public.owner_stats(
  p_tenant_slug text,
  p_from        timestamptz,
  p_to          timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_manage_tenant(p_tenant_slug) then
    raise exception 'Нет доступа к этой студии' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    -- Заезды: записи, которые начинаются в периоде и не отменены.
    'visits', (select count(*) from public.bookings b
               where b.tenant_slug = p_tenant_slug and b.starts_at >= p_from and b.starts_at < p_to
                 and b.status <> 'cancelled'),
    'done', (select count(*) from public.bookings b
             where b.tenant_slug = p_tenant_slug and b.starts_at >= p_from and b.starts_at < p_to
               and b.status = 'done'),
    'pending', (select count(*) from public.bookings b
                where b.tenant_slug = p_tenant_slug and b.starts_at >= p_from and b.starts_at < p_to
                  and b.status = 'pending'),
    'cancelled', (select count(*) from public.bookings b
                  where b.tenant_slug = p_tenant_slug and b.starts_at >= p_from and b.starts_at < p_to
                    and b.status = 'cancelled'),
    -- Ожидаемая выручка по прайсу — для сравнения с полученной.
    'expected', (select coalesce(sum(b.price), 0) from public.bookings b
                 where b.tenant_slug = p_tenant_slug and b.starts_at >= p_from and b.starts_at < p_to
                   and b.status <> 'cancelled'),
    -- Реально полученные деньги: оплаты минус возвраты по дате операции.
    'received', (select coalesce(sum(p.amount) filter (where p.kind = 'payment'), 0)
                        - coalesce(sum(p.amount) filter (where p.kind = 'refund'), 0)
                 from public.payments p
                 where p.tenant_slug = p_tenant_slug and p.created_at >= p_from and p.created_at < p_to),
    'refunds', (select coalesce(sum(p.amount), 0) from public.payments p
                where p.tenant_slug = p_tenant_slug and p.kind = 'refund'
                  and p.created_at >= p_from and p.created_at < p_to)
  );
end;
$$;

create or replace function public.owner_payments(
  p_tenant_slug text,
  p_from        timestamptz,
  p_to          timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_manage_tenant(p_tenant_slug) then
    raise exception 'Нет доступа к этой студии' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.created_at desc)
    from (
      select p.id, p.booking_id, b.code as booking_code, b.service_name, b.contact_name,
             p.kind, p.amount, p.method, p.note, p.created_at
      from public.payments p
      left join public.bookings b on b.id = p.booking_id
      where p.tenant_slug = p_tenant_slug and p.created_at >= p_from and p.created_at < p_to
      order by p.created_at desc
      limit 500
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.owner_create_booking(
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
set search_path = public
as $$
declare
  cfg jsonb;
begin
  if not public.can_manage_tenant(p_tenant_slug) then
    raise exception 'Нет доступа к этой студии' using errcode = '42501';
  end if;
  cfg := public.studio_config_any(p_tenant_slug);
  -- Владелец может записать «на сейчас» и дальше горизонта (звонок
  -- постоянного клиента), но не в нерабочее время и не в занятый бокс.
  return public.insert_booking_core(
    p_tenant_slug, cfg, p_service_id, p_start, p_name, p_phone,
    p_car, p_comment, p_request_id, 'owner', false
  );
end;
$$;

create or replace function public.owner_reschedule_booking(p_booking_id uuid, p_start timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
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

  perform pg_advisory_xact_lock(hashtext('booking:' || b.tenant_slug));

  cfg := public.studio_config_any(b.tenant_slug);
  buffer_min := coalesce((cfg ->> 'bufferMin')::int, 0);
  select s into service from jsonb_array_elements(cfg -> 'services') s where s ->> 'id' = b.service_id;
  if service is null then
    -- Услугу убрали из прайса — переносим с той же длительностью.
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

-- Статусы: pending → confirmed (подтверждена) → in_progress (принята в
-- работу) → done (готова). Отмена — из любого незавершённого.
create or replace function public.owner_set_status(p_booking_id uuid, p_status public.booking_status)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings%rowtype;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'Запись не найдена';
  end if;
  if not public.can_manage_tenant(b.tenant_slug) then
    raise exception 'Нет доступа к записи' using errcode = '42501';
  end if;
  if p_status = 'pending' then
    raise exception 'Вернуть запись в «ожидает» нельзя';
  end if;
  if b.status = 'cancelled' and p_status <> 'cancelled' then
    -- Восстановление отменённой: бокс мог уже уйти другому.
    if exists (
      select 1 from public.bookings o
      where o.tenant_slug = b.tenant_slug and o.box_id = b.box_id and o.id <> b.id
        and o.status in ('pending', 'confirmed', 'in_progress')
        and tstzrange(o.busy_from, o.busy_to) && tstzrange(b.busy_from, b.busy_to)
    ) then
      raise exception 'Время уже занято другой записью — создайте новую';
    end if;
  end if;

  update public.bookings set status = p_status where id = b.id;
  return jsonb_build_object('ok', true, 'id', b.id, 'status', p_status);
end;
$$;

-- Старый вариант искал по коду во всех студиях — оставляем обёртку по id.
drop function if exists public.set_booking_status(text, public.booking_status);

create or replace function public.owner_add_payment(
  p_booking_id uuid,
  p_kind       text,
  p_amount     integer,
  p_method     text default 'cash',
  p_note       text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b    public.bookings%rowtype;
  paid int;
  pid  uuid;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'Запись не найдена';
  end if;
  if not public.can_manage_tenant(b.tenant_slug) then
    raise exception 'Нет доступа к записи' using errcode = '42501';
  end if;
  if p_kind not in ('payment', 'refund') then
    raise exception 'Тип операции: payment или refund';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000 then
    raise exception 'Сумма должна быть больше нуля';
  end if;

  select coalesce(sum(case when kind = 'payment' then amount else -amount end), 0)
  into paid from public.payments where booking_id = b.id;

  if p_kind = 'refund' and p_amount > paid then
    raise exception 'Возврат больше полученного по записи (получено % ₽)', round(paid / 100.0);
  end if;

  insert into public.payments (tenant_slug, booking_id, kind, amount, method, note, created_by)
  values (b.tenant_slug, b.id, p_kind, p_amount, coalesce(p_method, 'cash'), left(coalesce(p_note, ''), 300), auth.uid())
  returning id into pid;

  return jsonb_build_object(
    'ok', true, 'id', pid,
    'paid', paid + case when p_kind = 'payment' then p_amount else -p_amount end
  );
end;
$$;

-- Сохранение правок владельца. Белый список ключей + проверка формата.
-- Клиент дополнительно валидирует zod-схемой, но доверять ему нельзя.
create or replace function public.owner_save_settings(p_tenant_slug text, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed text[] := array[
    'name', 'tagline', 'description', 'phone', 'messengers', 'address', 'hours', 'closedDates',
    'bufferMin', 'minNoticeHours', 'bookingHorizonDays', 'services', 'boxes', 'heroPhoto',
    'logo', 'gallery', 'infoCards', 'cancellation', 'assistantSuggestions'
  ];
  clean jsonb := '{}'::jsonb;
  k     text;
  v     jsonb;
  item  jsonb;
  merged jsonb;
begin
  if not public.is_tenant_owner(p_tenant_slug) then
    raise exception 'Менять настройки может только владелец студии' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Пустые изменения';
  end if;

  for k, v in select * from jsonb_each(p_patch) loop
    if not (k = any(allowed)) then
      raise exception 'Поле % нельзя менять из кабинета', k;
    end if;
    clean := clean || jsonb_build_object(k, v);
  end loop;

  if clean ? 'name' and length(trim(coalesce(clean ->> 'name', ''))) < 1 then
    raise exception 'Название не может быть пустым';
  end if;
  if clean ? 'phone' and length(regexp_replace(coalesce(clean ->> 'phone', ''), '[^0-9]', '', 'g')) < 5 then
    raise exception 'Проверьте телефон';
  end if;

  if clean ? 'services' then
    if jsonb_typeof(clean -> 'services') <> 'array' or jsonb_array_length(clean -> 'services') = 0 then
      raise exception 'Нужна хотя бы одна услуга';
    end if;
    for item in select * from jsonb_array_elements(clean -> 'services') loop
      if coalesce(item ->> 'id', '') = '' or coalesce(trim(item ->> 'name'), '') = '' then
        raise exception 'У каждой услуги должны быть id и название';
      end if;
      if jsonb_typeof(item -> 'price') <> 'number' or (item ->> 'price')::numeric < 0
         or (item ->> 'price')::numeric <> floor((item ->> 'price')::numeric) then
        raise exception 'Цена услуги «%» должна быть целым числом копеек', item ->> 'name';
      end if;
      if jsonb_typeof(item -> 'durationMin') <> 'number'
         or (item ->> 'durationMin')::numeric not between 15 and 10080 then
        raise exception 'Длительность «%»: от 15 минут до 7 дней', item ->> 'name';
      end if;
      if item ? 'days' and (item ->> 'days')::numeric not between 1 and 14 then
        raise exception 'Дней для «%»: от 1 до 14', item ->> 'name';
      end if;
    end loop;
    if (select count(distinct s ->> 'id') from jsonb_array_elements(clean -> 'services') s)
       <> jsonb_array_length(clean -> 'services') then
      raise exception 'id услуг повторяются';
    end if;
  end if;

  if clean ? 'boxes' then
    if jsonb_typeof(clean -> 'boxes') <> 'array' or jsonb_array_length(clean -> 'boxes') = 0 then
      raise exception 'Нужен хотя бы один бокс';
    end if;
    if exists (select 1 from jsonb_array_elements(clean -> 'boxes') b
               where coalesce(b ->> 'id', '') = '' or coalesce(trim(b ->> 'name'), '') = '') then
      raise exception 'У каждого бокса должны быть id и название';
    end if;
  end if;

  if clean ? 'hours' then
    if jsonb_typeof(clean -> 'hours') <> 'array' or jsonb_array_length(clean -> 'hours') <> 7 then
      raise exception 'Нужны часы на все 7 дней недели';
    end if;
    for item in select * from jsonb_array_elements(clean -> 'hours') loop
      if (item ->> 'open') is not null and (
           (item ->> 'open') !~ '^([01]\d|2[0-3]):[0-5]\d$'
           or (item ->> 'close') !~ '^([01]\d|2[0-3]):[0-5]\d$'
           or (item ->> 'open') >= (item ->> 'close')) then
        raise exception 'Часы работы: открытие раньше закрытия, формат ЧЧ:ММ';
      end if;
    end loop;
  end if;

  if clean ? 'closedDates' and exists (
    select 1 from jsonb_array_elements_text(clean -> 'closedDates') d where d !~ '^\d{4}-\d{2}-\d{2}$'
  ) then
    raise exception 'Нерабочие даты — в формате ГГГГ-ММ-ДД';
  end if;

  if clean ? 'infoCards' and (jsonb_typeof(clean -> 'infoCards') <> 'array' or jsonb_array_length(clean -> 'infoCards') <> 3) then
    raise exception 'Информационных карточек должно быть ровно 3';
  end if;

  if clean ? 'gallery' then
    if jsonb_typeof(clean -> 'gallery') <> 'array' then
      raise exception 'Галерея должна быть списком';
    end if;
    if exists (select 1 from jsonb_array_elements(clean -> 'gallery') g where coalesce(g ->> 'photo', '') = '') then
      raise exception 'У каждой карточки галереи должно быть фото';
    end if;
  end if;

  if clean ? 'heroPhoto' and coalesce(clean ->> 'heroPhoto', '') = '' then
    raise exception 'Главное фото не может быть пустым';
  end if;

  insert into public.tenant_settings (tenant_slug, patch, updated_by)
  values (p_tenant_slug, clean, auth.uid())
  on conflict (tenant_slug) do update
    set patch = public.tenant_settings.patch || excluded.patch,
        updated_by = excluded.updated_by
  returning patch into merged;

  return jsonb_build_object('ok', true, 'patch', merged);
end;
$$;

-- Правки владельца для показа на сайте (без черновиков).
create or replace function public.studio_patch(p_tenant_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(s.patch, '{}'::jsonb)
  from public.tenants t
  left join public.tenant_settings s on s.tenant_slug = t.slug
  where t.slug = p_tenant_slug and (t.is_published or public.is_tenant_owner(t.slug));
$$;

-- Сводка на сегодня: считаем день в поясе студии.
create or replace function public.studio_today(p_tenant_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tz      text;
  d_start timestamptz;
begin
  if not public.can_manage_tenant(p_tenant_slug) then
    raise exception 'Нет доступа' using errcode = '42501';
  end if;
  tz := coalesce(public.studio_config_any(p_tenant_slug) ->> 'timezone', 'Europe/Moscow');
  d_start := public.studio_day_start(tz, (now() at time zone tz)::date);
  return public.owner_stats(p_tenant_slug, d_start, d_start + interval '1 day');
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Помощник: лимиты и учёт
-- ---------------------------------------------------------------------------

-- Проверка перед вопросом. Три предела:
--   • человек: p_actor_limit вопросов в час;
--   • студия: p_tenant_daily вопросов в сутки;
--   • проект: p_daily_tokens токенов модели в сутки на всё — это и есть
--     потолок расходов на модель.
create or replace function public.assistant_quota(
  p_tenant_slug  text,
  p_actor        text,
  p_actor_limit  int default 20,
  p_tenant_daily int default 300,
  p_daily_tokens int default 400000
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  perform pg_advisory_xact_lock(hashtext('assistant:' || p_tenant_slug || ':' || p_actor));

  select count(*) into n from public.assistant_usage
  where tenant_slug = p_tenant_slug and actor = p_actor and created_at > now() - interval '1 hour';
  if n >= p_actor_limit then
    return jsonb_build_object('ok', false, 'reason', 'Слишком много вопросов подряд. Попробуйте через час.');
  end if;

  select count(*) into n from public.assistant_usage
  where tenant_slug = p_tenant_slug and created_at > now() - interval '1 day';
  if n >= p_tenant_daily then
    return jsonb_build_object('ok', false, 'reason', 'Помощник на сегодня исчерпал лимит. Позвоните в студию.');
  end if;

  select coalesce(sum(tokens), 0) into n from public.assistant_usage
  where created_at > now() - interval '1 day';
  if n >= p_daily_tokens then
    return jsonb_build_object('ok', false, 'reason', 'Помощник временно недоступен. Позвоните в студию.');
  end if;

  -- Резервируем место сразу, чтобы параллельные вопросы не проскочили лимит.
  insert into public.assistant_usage (tenant_slug, actor, question)
  values (p_tenant_slug, p_actor, '…');

  return jsonb_build_object('ok', true);
end;
$$;

-- Дописывает вопрос, ответ и потраченные токены в последнюю резервную строку.
create or replace function public.assistant_record(
  p_tenant_slug text,
  p_actor       text,
  p_mode        text,
  p_question    text,
  p_answer      text,
  p_tokens      int
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.assistant_usage
  set question = left(coalesce(p_question, ''), 500),
      answer   = left(coalesce(p_answer, ''), 2000),
      tokens   = greatest(coalesce(p_tokens, 0), 0),
      mode     = coalesce(p_mode, 'client')
  where id = (
    select id from public.assistant_usage
    where tenant_slug = p_tenant_slug and actor = p_actor and question = '…'
    order by created_at desc limit 1
  );
$$;

-- ---------------------------------------------------------------------------
-- 10. Хранилище фото владельца
-- ---------------------------------------------------------------------------

-- Путь файла: <slug>/<уникальное имя>. Читать может любой (фото на
-- сайте), писать — только владелец своей папки. Имя файла уникальное,
-- поэтому загрузка одного фото не может затереть другое.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('studio-media', 'studio-media', true, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
    on conflict (id) do update set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

    execute 'drop policy if exists studio_media_read on storage.objects';
    execute $p$create policy studio_media_read on storage.objects for select
      using (bucket_id = 'studio-media')$p$;

    execute 'drop policy if exists studio_media_owner_insert on storage.objects';
    execute $p$create policy studio_media_owner_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'studio-media' and public.is_tenant_owner((storage.foldername(name))[1]))$p$;

    execute 'drop policy if exists studio_media_owner_update on storage.objects';
    execute $p$create policy studio_media_owner_update on storage.objects for update to authenticated
      using (bucket_id = 'studio-media' and public.is_tenant_owner((storage.foldername(name))[1]))$p$;

    execute 'drop policy if exists studio_media_owner_delete on storage.objects';
    execute $p$create policy studio_media_owner_delete on storage.objects for delete to authenticated
      using (bucket_id = 'studio-media' and public.is_tenant_owner((storage.foldername(name))[1]))$p$;
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- 12. Напоминание за день (web push)
-- ---------------------------------------------------------------------------

-- Подписка браузера на пуш для конкретной записи. Отправляет Edge
-- Function reminders по расписанию (cron каждые 15 минут).
create table if not exists public.booking_reminders (
  id          uuid primary key default gen_random_uuid(),
  tenant_slug text        not null references public.tenants(slug) on delete cascade,
  booking_id  uuid        not null references public.bookings(id) on delete cascade,
  endpoint    text        not null,
  p256dh      text        not null,
  auth        text        not null,
  remind_at   timestamptz not null,
  sent_at     timestamptz,
  error       text,
  created_at  timestamptz not null default now(),
  unique (booking_id, endpoint)
);
create index if not exists booking_reminders_due_idx on public.booking_reminders (remind_at) where sent_at is null;
alter table public.booking_reminders enable row level security;
-- Политик нет: читать и писать можно только через функции ниже.

create or replace function public.subscribe_reminder(
  p_tenant_slug  text,
  p_code         text,
  p_phone        text,
  p_subscription jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b         public.bookings%rowtype;
  remind_at timestamptz;
begin
  select * into b from public.bookings
  where tenant_slug = p_tenant_slug
    and code = upper(trim(p_code))
    and phone_key = regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
    and status in ('pending', 'confirmed');
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'Запись не найдена');
  end if;

  if coalesce(p_subscription ->> 'endpoint', '') !~ '^https://'
     or coalesce(p_subscription #>> '{keys,p256dh}', '') = ''
     or coalesce(p_subscription #>> '{keys,auth}', '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'Браузер не выдал подписку на уведомления');
  end if;

  -- За сутки; если до визита меньше суток — за 2 часа.
  remind_at := case
    when b.starts_at - interval '24 hours' > now() then b.starts_at - interval '24 hours'
    when b.starts_at - interval '2 hours' > now() then b.starts_at - interval '2 hours'
    else null
  end;
  if remind_at is null then
    return jsonb_build_object('ok', false, 'reason', 'До визита меньше двух часов — напоминание не нужно');
  end if;

  insert into public.booking_reminders (tenant_slug, booking_id, endpoint, p256dh, auth, remind_at)
  values (b.tenant_slug, b.id, p_subscription ->> 'endpoint', p_subscription #>> '{keys,p256dh}',
          p_subscription #>> '{keys,auth}', remind_at)
  on conflict (booking_id, endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, remind_at = excluded.remind_at, sent_at = null, error = null;

  return jsonb_build_object('ok', true, 'remindAt', remind_at);
end;
$$;

-- Для Edge Function reminders (service_role).
create or replace function public.reminders_due(p_limit int default 100)
returns table (
  id uuid, endpoint text, p256dh text, auth text,
  tenant_slug text, studio_name text, timezone text, address text,
  code text, service_name text, starts_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.endpoint, r.p256dh, r.auth,
         b.tenant_slug, cfg ->> 'name', coalesce(cfg ->> 'timezone', 'Europe/Moscow'), cfg #>> '{address,full}',
         b.code, b.service_name, b.starts_at
  from public.booking_reminders r
  join public.bookings b on b.id = r.booking_id
  cross join lateral (select public.studio_config_any(b.tenant_slug) as cfg) c
  where r.sent_at is null
    and r.remind_at <= now()
    and b.status in ('pending', 'confirmed')
    and b.starts_at > now()
  order by r.remind_at
  limit p_limit;
$$;

create or replace function public.reminder_mark(p_id uuid, p_error text default null)
returns void
language sql
security definer
set search_path = public
as $$
  update public.booking_reminders
  set sent_at = now(), error = p_error
  where id = p_id;
$$;

-- ---------------------------------------------------------------------------
-- 11. Права на функции
-- ---------------------------------------------------------------------------

-- В Postgres EXECUTE по умолчанию выдан PUBLIC, а Supabase дополнительно
-- выдаёт anon/authenticated. Закрываем всё служебное и открываем явно.
-- Только наши функции: функции расширений (btree_gist, pgcrypto) не трогаем.
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

-- Публичные (посетитель сайта).
grant execute on function public.studio_config(text)                 to anon, authenticated;
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

-- Кабинет (проверка прав внутри каждой функции).
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

-- Всё остальное (assistant_quota, assistant_record, assistant_context,
-- next_free_slots, insert_booking_core, pick_free_box…) — только service_role,
-- выдано в цикле выше.
