-- ---------------------------------------------------------------------------
-- Ограничения для онлайн-записи клиентов.
--
-- Проблема: боксов в студии несколько (у DETAILING 1808 — 3), поэтому один
-- человек мог записаться на одно и то же время три раза, заняв все боксы.
--
-- Правила (только для записи с сайта; владелец в кабинете не ограничен):
--   1. Один телефон — одна активная запись на день студии. Нужна вторая
--      услуга или другое время — звонок в студию, владелец добавит сам.
--   2. Не больше 3 предстоящих активных записей на один телефон.
--
-- Телефон сравнивается по последним 10 цифрам, так что «+7 918…»,
-- «8 918…» и «918…» — один и тот же номер.
--
-- Проверка атомарная: запросы с одного номера выстраиваются в очередь
-- (advisory lock на студию+номер), поэтому параллельные клики с разных
-- вкладок не проскочат. Повтор той же попытки (тот же p_request_id,
-- двойной клик) по-прежнему возвращает уже созданную запись.
--
-- Применить: SQL Editor → вставить файл целиком → Run. Повторный запуск
-- безопасен (create or replace). Схема таблиц не меняется.
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
set search_path = public
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
begin
  v_cfg := public.studio_config(p_tenant_slug);
  if v_cfg is null then
    raise exception 'Студия не найдена или ещё не опубликована';
  end if;

  v_key := right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 10);

  if length(v_key) = 10 and p_start is not null then
    -- Очередь на студию+номер: до конца транзакции второй запрос с этого
    -- номера ждёт, пока первый не вставит запись или не получит отказ.
    perform pg_advisory_xact_lock(hashtextextended('booking-phone:' || p_tenant_slug || ':' || v_key, 0));

    -- Повтор той же попытки — отдаём уже созданную запись, без проверок.
    if p_request_id is null or not exists (
      select 1 from public.bookings b
      where b.tenant_slug = p_tenant_slug and b.request_id = p_request_id
    ) then
      v_tz := coalesce(nullif(v_cfg ->> 'timezone', ''), 'Europe/Moscow');
      v_day_start := ((p_start at time zone v_tz)::date)::timestamp at time zone v_tz;
      v_day_end := v_day_start + interval '1 day';
      v_phone := coalesce(nullif(v_cfg ->> 'phone', ''), 'студии');

      -- 1. Уже есть активная запись, которая задевает этот день
      --    (в том числе многодневная работа, начатая раньше).
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

      -- 2. Слишком много предстоящих записей на один номер.
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
  'Атомарная запись клиента: один телефон — одна запись на день, не больше 3 предстоящих. Повтор с тем же p_request_id возвращает ту же запись.';

grant execute on function public.create_booking(text, text, timestamptz, text, text, text, text, uuid) to anon, authenticated;
