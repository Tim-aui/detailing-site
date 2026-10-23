-- Кабинет: реквизиты оператора ПД и счётчик Яндекс.Метрики
-- (FIXES.md, 4.1 и 3.7). Добавляет ключи legal и metrikaId в белый список
-- owner_save_settings с проверкой формата. Список ключей держите в
-- синхроне с OWNER_EDITABLE_KEYS в src/tenants/schema.ts.

create or replace function public.owner_save_settings(p_tenant_slug text, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  allowed text[] := array[
    'name', 'tagline', 'description', 'phone', 'messengers', 'address', 'hours', 'closedDates',
    'bufferMin', 'minNoticeHours', 'bookingHorizonDays', 'services', 'boxes', 'heroPhoto',
    'logo', 'gallery', 'infoCards', 'cancellation', 'assistantSuggestions',
    'legal', 'metrikaId'
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

  -- Реквизиты оператора ПД (политика /s/<slug>/privacy).
  if clean ? 'legal' then
    if jsonb_typeof(clean -> 'legal') <> 'object' then
      raise exception 'Реквизиты должны быть объектом';
    end if;
    if exists (select 1 from jsonb_object_keys(clean -> 'legal') as lk(key_name) where lk.key_name not in ('operator', 'inn', 'ogrn', 'email')) then
      raise exception 'В реквизитах допустимы только operator, inn, ogrn, email';
    end if;
    if coalesce(clean #>> '{legal,inn}', '') !~ '^(\d{10}|\d{12})?$' then
      raise exception 'ИНН — 10 цифр (организация) или 12 (ИП)';
    end if;
    if coalesce(clean #>> '{legal,ogrn}', '') !~ '^(\d{13}|\d{15})?$' then
      raise exception 'ОГРН — 13 цифр, ОГРНИП — 15';
    end if;
    if coalesce(clean #>> '{legal,email}', '') !~ '^([^@\s]+@[^@\s]+\.[^@\s]+)?$' then
      raise exception 'Проверьте e-mail для запросов по персональным данным';
    end if;
    if length(coalesce(clean #>> '{legal,operator}', '')) > 300 then
      raise exception 'Наименование оператора слишком длинное';
    end if;
  end if;

  -- Номер счётчика Яндекс.Метрики: только цифры или пусто.
  if clean ? 'metrikaId' and coalesce(clean ->> 'metrikaId', '') !~ '^\d{0,12}$' then
    raise exception 'Номер счётчика Метрики — только цифры';
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

revoke execute on function public.owner_save_settings(text, jsonb) from public, anon;
grant execute on function public.owner_save_settings(text, jsonb) to authenticated;
