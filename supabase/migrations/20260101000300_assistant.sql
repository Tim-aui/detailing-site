-- Свободные окна и помощник студии.
--
-- Зачем считать окна в SQL, если клиент уже умеет: клиентский расчёт нужен
-- для мгновенного отклика интерфейса, но он ничего не знает о записях,
-- которые появились минуту назад. Эта функция — правда сервера, её
-- использует и бронь, и помощник.

-- ---------------------------------------------------------------------------
-- Свободные окна
-- ---------------------------------------------------------------------------

-- Возвращает ближайшие окна, в которые есть хотя бы один свободный бокс.
-- Проверяет каждый бокс отдельно, а не «сколько занято», поэтому
-- многодневная работа и правило acceptsLongStay учитываются точно так же,
-- как при реальной записи.
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
set search_path = public
as $$
declare
  cfg          jsonb;
  tz           text;
  service      jsonb;
  duration_min int;
  days_needed  int;
  buffer_min   int;
  d            date;
  open_min     int;
  close_min    int;
  m            int;
  slot_start   timestamptz;
  slot_end     timestamptz;
  found_slot   boolean;
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

  if duration_min <= 0 or p_to <= p_from then
    return;
  end if;

  for d in
    select generate_series(
      (p_from at time zone tz)::date,
      (p_to   at time zone tz)::date,
      interval '1 day'
    )::date
  loop
    open_min  := public.hhmm_to_min(public.studio_hours_for(cfg, d) ->> 'open');
    close_min := public.hhmm_to_min(public.studio_hours_for(cfg, d) ->> 'close');
    if open_min is null or close_min is null then
      continue; -- выходной
    end if;

    -- Последний допустимый старт — чтобы работа закончилась до закрытия.
    for m in 0..greatest(close_min - open_min - duration_min, 0) by 30 loop
      -- Время в таймзоне студии, потом в UTC: так переживается переход на
      -- летнее время, когда «10:00» в марте и в октябре — разные моменты.
      slot_start := (d::timestamp + make_interval(mins => open_min + m)) at time zone tz;
      slot_end   := slot_start + make_interval(mins => duration_min);

      if slot_start < p_from or slot_start > p_to then
        continue;
      end if;

      select exists (
        select 1
        from jsonb_array_elements(cfg -> 'boxes') b
        where coalesce((b ->> 'isActive')::boolean, true)
          and (days_needed = 1 or coalesce((b ->> 'acceptsLongStay')::boolean, true))
          and not exists (
            select 1
            from public.bookings bk
            where bk.tenant_slug = p_tenant_slug
              and bk.box_id = b ->> 'id'
              and bk.status in ('pending', 'confirmed', 'in_progress')
              and tstzrange(bk.busy_from, bk.busy_to) && tstzrange(
                slot_start - make_interval(mins => buffer_min),
                slot_end + make_interval(mins => buffer_min)
              )
          )
      ) into found_slot;

      if found_slot then
        start_at := slot_start;
        end_at := slot_end;
        return next;
      end if;
    end loop;
  end loop;
end;
$$;

comment on function public.next_free_slots is
  'Ближайшие окна услуги, где есть свободный бокс. Общая правда для брони и подсказок помощника.';

-- Обёртка для клиента: отдаёт окна конкретной студии по id услуги.
create or replace function public.studio_free_slots(
  p_tenant_slug text,
  p_service_id  text,
  p_from        timestamptz default null,
  p_to          timestamptz default null,
  p_limit       int default 40
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  cfg    jsonb;
  from_t timestamptz;
  to_t   timestamptz;
  result jsonb := '[]'::jsonb;
  item   jsonb;
begin
  cfg := public.studio_config(p_tenant_slug);
  if cfg is null then
    raise exception 'Студия не найдена или ещё не опубликована';
  end if;

  from_t := coalesce(p_from, now() + make_interval(hours => coalesce((cfg ->> 'minNoticeHours')::int, 0)));
  to_t := coalesce(
    p_to,
    least(from_t + interval '30 days', now() + make_interval(days => coalesce((cfg ->> 'bookingHorizonDays')::int, 30)))
  );

  for item in
    select jsonb_build_object('startUtc', s.start_at, 'endUtc', s.end_at)
    from public.next_free_slots(p_tenant_slug, p_service_id, from_t, to_t, least(p_limit, 200)) s
  loop
    result := result || jsonb_build_array(item);
  end loop;

  return jsonb_build_object('serviceId', p_service_id, 'slots', result, 'from', from_t, 'to', to_t);
end;
$$;

-- ---------------------------------------------------------------------------
-- Помощник
-- ---------------------------------------------------------------------------

-- Контекст для ответа. Сюда не попадает ничего из bookings: помощник на
-- публичной странице не должен знать о чужих записях даже косвенно.
create or replace function public.assistant_context(p_tenant_slug text, p_now timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cfg    jsonb;
  tz     text;
  svc    jsonb;
  slots  jsonb := '[]'::jsonb;
  item   jsonb;
  max_to timestamptz;
begin
  cfg := public.studio_config(p_tenant_slug);
  if cfg is null then
    return jsonb_build_object('error', 'Студия не найдена');
  end if;

  tz := coalesce(cfg ->> 'timezone', 'Europe/Moscow');
  max_to := p_now + make_interval(days => least(coalesce((cfg ->> 'bookingHorizonDays')::int, 30), 14));

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', s ->> 'id',
        'name', s ->> 'name',
        'price', (s ->> 'price')::int,
        'durationMin', (s ->> 'durationMin')::int,
        'days', greatest(coalesce((s ->> 'days')::int, 1), 1)
      )
      order by coalesce((s ->> 'isPopular')::boolean, false) desc, s ->> 'id'
    ),
    '[]'::jsonb
  )
  into svc
  from jsonb_array_elements(cfg -> 'services') s
  where coalesce((s ->> 'isActive')::boolean, true);

  for item in
    select jsonb_build_object(
      'service', s ->> 'name',
      'slot', to_char(sl.start_at at time zone tz, 'DD.MM (DD) HH24:MI')
    )
    from jsonb_array_elements(cfg -> 'services') s
    cross join lateral public.next_free_slots(
      p_tenant_slug, s ->> 'id', p_now, max_to, 3
    ) sl
    where coalesce((s ->> 'isActive')::boolean, true)
    order by coalesce((s ->> 'isPopular')::boolean, false) desc, sl.start_at
    limit 15
  loop
    slots := slots || jsonb_build_array(item);
  end loop;

  return jsonb_build_object(
    'studio', jsonb_build_object(
      'name', cfg ->> 'name',
      'tagline', cfg ->> 'tagline',
      'phone', cfg ->> 'phone',
      'address', cfg ->> 'address',
      'timezone', tz,
      'hours', cfg -> 'hours'
    ),
    'services', svc,
    'freeSlots', slots,
    'cancellation', cfg -> 'cancellation',
    'generatedAt', p_now
  );
end;
$$;

-- Регистрация вопроса с лимитом: 20 вопросов в час на одного человека.
-- Возвращает false при превышении — Edge Function отвечает «позже».
create or replace function public.assistant_log(
  p_tenant_slug text,
  p_actor       text,
  p_question    text,
  p_answer      text default '',
  p_limit       int default 20
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  recent int;
begin
  select count(*) into recent
  from public.assistant_usage u
  where u.tenant_slug = p_tenant_slug
    and u.actor = p_actor
    and u.created_at > now() - interval '1 hour';

  if recent >= p_limit then
    return false;
  end if;

  insert into public.assistant_usage (tenant_slug, actor, question, answer)
  values (
    p_tenant_slug,
    p_actor,
    left(coalesce(p_question, ''), 500),
    left(coalesce(p_answer, ''), 2000)
  );

  return true;
end;
$$;

comment on function public.assistant_log is
  'Пишет вопрос в историю, false при превышении лимита. Вызывается только с service_role.';
