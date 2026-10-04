-- Переименование студии в базе: старый адрес → новый.
-- Запуск: Supabase → SQL Editor → вставить файл целиком → Run.
-- Меняйте только две строки v_old / v_new. Повторный запуск безопасен.
--
-- Переносит всё, что ссылается на студию: записи, оплаты, напоминания,
-- вход владельца, правки из кабинета, историю помощника. Таблицы находятся
-- автоматически по внешним ключам на public.tenants, поэтому скрипт не
-- устареет, если таблиц станет больше. Фото, загруженные в кабинете, остаются
-- на месте — ссылки на них не меняются.
do $$
declare
  v_old  text := 'demo';             -- было
  v_new  text := '1808-detailing';   -- стало (как slug в tenants/<папка>/studio.json)
  r      record;
  n      bigint;
  v_busy bigint := 0;
begin
  if v_new !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Новый адрес «%»: только латиница в нижнем регистре, цифры и дефисы', v_new;
  end if;

  if not exists (select 1 from public.tenants where slug = v_old) then
    if exists (select 1 from public.tenants where slug = v_new) then
      raise notice 'Уже переименовано: «%» есть в базе, «%» нет. Ничего не делаю.', v_new, v_old;
      return;
    end if;
    raise exception 'Студии «%» нет в базе — проверьте v_old', v_old;
  end if;

  -- «Новая» студия уже есть (например, tenant:push сделали раньше этого
  -- скрипта). Если у неё нет ни записей, ни владельца — это пустая копия,
  -- её можно убрать. Если данные есть — останавливаемся, ничего не трогаем.
  if exists (select 1 from public.tenants where slug = v_new) then
    for r in
      select c.conrelid::regclass as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and c.confrelid = 'public.tenants'::regclass
    loop
      execute format('select count(*) from %s where %I = $1', r.tbl, r.col) into n using v_new;
      v_busy := v_busy + n;
    end loop;
    if v_busy > 0 then
      raise exception 'В базе уже есть студия «%» со своими данными (% строк). Остановился, ничего не менял.', v_new, v_busy;
    end if;
    delete from public.tenants where slug = v_new;
    raise notice 'Убрал пустую копию «%», созданную раньше времени', v_new;
  end if;

  insert into public.tenants (slug, name, timezone, config, is_published, created_at)
  select v_new, name, timezone,
         jsonb_set(config, '{slug}', to_jsonb(v_new))
           || jsonb_build_object('previousSlugs', jsonb_build_array(v_old)),
         is_published, created_at
  from public.tenants
  where slug = v_old;

  for r in
    select c.conrelid::regclass as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'public.tenants'::regclass
    order by 1
  loop
    execute format('update %s set %I = $1 where %I = $2', r.tbl, r.col, r.col) using v_new, v_old;
    get diagnostics n = row_count;
    raise notice '%: перенесено %', r.tbl, n;
  end loop;

  delete from public.tenants where slug = v_old;
  raise notice 'Готово: «%» → «%»', v_old, v_new;
end $$;

-- Проверка: должна быть строка с новым адресом и количеством записей.
select t.slug, t.name, t.is_published,
       (select count(*) from public.bookings b where b.tenant_slug = t.slug)       as zapisey,
       (select count(*) from public.tenant_members m where m.tenant_slug = t.slug) as vhodov
from public.tenants t
order by t.slug;
