-- Демо-данные для показа кабинета (FIXES.md, блок 5).
--
-- ⚠ Запускать ТОЛЬКО для демо-студии. Демо-записи занимают боксы: на
-- настоящей студии клиенты не смогут записаться на эти часы.
--
-- Что создаёт для студии v_slug:
--   • 8 записей: прошлые (done, cancelled) и будущие (pending, confirmed),
--     в рабочие часы, по разным боксам;
--   • 4 оплаты (3 за выполненные, 1 предоплата) — раздел «Деньги» не пустой.
-- Уведомления в Telegram на демо-записи не отправляются.
-- Все демо-строки помечены: comment = '[демо]', телефоны +7 900 000-00-1X.
-- Повторный запуск сначала удаляет прежние демо-строки этой студии.
--
-- Запуск: Supabase → SQL Editor → вставить файл, поменять v_slug → Run.
-- Удалить демо: блок «Очистка» внизу.

do $$
declare
  v_slug   text := 'bro-100';             -- ← студия
  cfg      jsonb := public.studio_config_any(v_slug);
  tz       text;
  svc      jsonb;
  boxes    text[];
  today    date;
  plan     jsonb := '[
    {"d": -6, "t": "10:00", "s": "done",      "name": "Алексей",  "car": "Kia Rio"},
    {"d": -4, "t": "12:00", "s": "done",      "name": "Марина",   "car": "Toyota Camry"},
    {"d": -3, "t": "11:00", "s": "cancelled", "name": "Игорь",    "car": "Lada Vesta"},
    {"d": -1, "t": "15:00", "s": "done",      "name": "Сергей",   "car": "BMW X5"},
    {"d":  1, "t": "10:00", "s": "confirmed", "name": "Ольга",    "car": "Hyundai Solaris"},
    {"d":  1, "t": "13:00", "s": "pending",   "name": "Дмитрий",  "car": "VW Polo"},
    {"d":  2, "t": "11:00", "s": "confirmed", "name": "Анна",     "car": "Skoda Octavia"},
    {"d":  3, "t": "14:00", "s": "pending",   "name": "Павел",    "car": "Mazda CX-5"}
  ]'::jsonb;
  item     jsonb;
  i        int := 0;
  v_start  timestamptz;
  v_end    timestamptz;
  v_id     uuid;
  buffer   int;
begin
  if cfg is null then
    raise exception 'Студия % не найдена', v_slug;
  end if;
  tz := coalesce(cfg ->> 'timezone', 'Europe/Moscow');
  buffer := coalesce((cfg ->> 'bufferMin')::int, 0);
  today := (now() at time zone tz)::date;
  -- Демо не должно сыпаться владельцу в Telegram.
  perform set_config('app.notify_skip', 'on', true);
  select array_agg(b ->> 'id' order by b ->> 'id') into boxes
  from jsonb_array_elements(cfg -> 'boxes') b where coalesce((b ->> 'isActive')::boolean, true);

  -- Прежние демо-строки этой студии.
  delete from public.payments p using public.bookings b
   where p.booking_id = b.id and b.tenant_slug = v_slug and b.comment = '[демо]';
  delete from public.bookings where tenant_slug = v_slug and comment = '[демо]';

  for item in select * from jsonb_array_elements(plan) loop
    i := i + 1;
    -- Услуги по кругу, только однодневные и короче 4 часов — чтобы влезть в день.
    select s into svc
    from jsonb_array_elements(cfg -> 'services') with ordinality as x(s, n)
    where coalesce((s ->> 'isActive')::boolean, true)
      and coalesce((s ->> 'days')::int, 1) = 1
      and (s ->> 'durationMin')::int <= 240
    order by n
    offset (i - 1) % greatest((select count(*) from jsonb_array_elements(cfg -> 'services') s2
                                where coalesce((s2 ->> 'isActive')::boolean, true)
                                  and coalesce((s2 ->> 'days')::int, 1) = 1
                                  and (s2 ->> 'durationMin')::int <= 240), 1)
    limit 1;

    v_start := ((today + (item ->> 'd')::int)::timestamp + (item ->> 't')::time) at time zone tz;
    v_end := v_start + make_interval(mins => (svc ->> 'durationMin')::int);

    insert into public.bookings (
      tenant_slug, code, service_id, service_name, box_id,
      starts_at, ends_at, busy_from, busy_to, status, price,
      contact_name, contact_phone, car, comment, source
    ) values (
      v_slug, public.new_booking_code(v_slug), svc ->> 'id', svc ->> 'name',
      boxes[1 + (i - 1) % array_length(boxes, 1)],
      v_start, v_end, v_start, v_end + make_interval(mins => buffer),
      (item ->> 's')::public.booking_status, (svc ->> 'price')::int,
      item ->> 'name', format('+7 900 000-00-1%s', i % 10), item ->> 'car', '[демо]', 'client'
    )
    returning id into v_id;

    -- Оплаты: две полные за выполненные, одна предоплата за подтверждённую.
    if item ->> 's' = 'done' and i <= 4 then
      insert into public.payments (tenant_slug, booking_id, kind, amount, method, note, created_at)
      values (v_slug, v_id, 'payment', (svc ->> 'price')::int,
              case when i % 2 = 0 then 'card' else 'cash' end, '[демо]', v_end);
    elsif item ->> 's' = 'confirmed' and i = 5 then
      insert into public.payments (tenant_slug, booking_id, kind, amount, method, note)
      values (v_slug, v_id, 'payment', least((svc ->> 'price')::int, 100000), 'transfer', '[демо] предоплата');
    end if;
  end loop;

  raise notice 'Демо для %: % записей', v_slug, i;
end;
$$;

-- ---------------------------------------------------------------------------
-- Очистка (раскомментировать и выполнить отдельно):
-- delete from public.payments p using public.bookings b
--  where p.booking_id = b.id and b.tenant_slug = 'bro-100' and b.comment = '[демо]';
-- delete from public.bookings where tenant_slug = 'bro-100' and comment = '[демо]';
