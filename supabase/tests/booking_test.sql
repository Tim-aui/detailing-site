-- Проверки базы: запускаются на чистой базе после миграций.
--   Локально: supabase/tests/run.sh (Postgres + заглушки auth/storage)
--   В Supabase: psql "$DATABASE_URL" -f supabase/tests/booking_test.sql
-- Скрипт откатывает всё в конце (begin … rollback).
\set ON_ERROR_STOP 1
\set QUIET 1
begin;

create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', msg; end if;
  raise notice 'ok  %', msg;
end $$;

-- Ожидаем ошибку с фрагментом текста.
create or replace function pg_temp.throws(sql text, fragment text, msg text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if position(fragment in sqlerrm) > 0 then
      raise notice 'ok  %  (%)', msg, sqlerrm;
      return;
    end if;
    raise exception 'FAIL: % — другая ошибка: %', msg, sqlerrm;
  end;
  raise exception 'FAIL: % — ошибки не было', msg;
end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;

-- Данные: две студии с одинаковыми id боксов.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@demo.test'),
  ('00000000-0000-0000-0000-00000000000b', 'stranger@other.test');
insert into public.tenants (slug, name, config, is_published)
values ('demo', 'Demo', :'democfg'::jsonb, true),
       ('other', 'Other', :'democfg'::jsonb, true),
       ('draft', 'Draft', :'democfg'::jsonb, false);
insert into public.tenant_members (tenant_slug, user_id) values
  ('demo', '00000000-0000-0000-0000-00000000000a'),
  ('other', '00000000-0000-0000-0000-00000000000b');

-- Базовые моменты: день через 3 дня по Москве, 10:00 и 12:00.
create temp table t_at as
select ((now() at time zone 'Europe/Moscow')::date + 3) as d,
       (((now() at time zone 'Europe/Moscow')::date + 3)::timestamp + time '10:00') at time zone 'Europe/Moscow' as t10,
       (((now() at time zone 'Europe/Moscow')::date + 3)::timestamp + time '12:00') at time zone 'Europe/Moscow' as t12;
grant select on t_at to anon, authenticated;

-- ===================== посетитель (anon) =====================
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select pg_temp.ok((select count(*) from public.bookings) = 0, 'anon не видит таблицу записей');

-- Бокса три (box-3 без длинных работ). Занимаем все три на 10:00.
select pg_temp.ok((public.create_booking('demo', 'wax', (select t10 from t_at), 'Иван', '+7 900 000-00-01', 'BMW', '', gen_random_uuid()) ->> 'boxId') = 'box-1', 'запись №1 → box-1');
select pg_temp.ok((public.create_booking('demo', 'wax', (select t10 from t_at), 'Пётр', '+7 900 000-00-02') ->> 'boxId') = 'box-2', 'запись №2 → box-2');
select pg_temp.ok((public.create_booking('demo', 'wax', (select t10 from t_at), 'Анна', '+7 900 000-00-03') ->> 'boxId') = 'box-3', 'запись №3 → box-3');
select pg_temp.throws($$select public.create_booking('demo', 'wax', (select t10 from t_at), 'Олег', '+7 900 000-00-04')$$,
  'занято', 'четвёртая запись на то же время отклонена');

-- Буфер 15 мин: воск 90 мин (10:00–11:30) + буфер → 11:30 занято, 12:00 свободно.
select pg_temp.throws($$select public.create_booking('demo', 'engine', (select t10 from t_at) + interval '90 minutes', 'Олег', '+7 900 000-00-04')$$,
  'занято', 'буфер между машинами соблюдается');
select pg_temp.ok((public.create_booking('demo', 'engine', (select t10 from t_at) + interval '105 minutes', 'Олег', '+7 900 000-00-04') ->> 'code') is not null,
  'ровно через 15 мин после конца бокс снова свободен');

-- Двойной клик: тот же request_id → та же запись.
create temp table t_req as select gen_random_uuid() as id;
grant select on t_req to anon;
create temp table t_first as select public.create_booking('demo', 'engine', (select t12 from t_at), 'Дмитрий', '+7 900 000-00-05', '', '', (select id from t_req)) as r;
select pg_temp.ok((public.create_booking('demo', 'engine', (select t12 from t_at), 'Дмитрий', '+7 900 000-00-05', '', '', (select id from t_req)) ->> 'repeated')::boolean,
  'повтор с тем же request_id вернул прежнюю запись');
reset role;
select pg_temp.ok((select count(*) from public.bookings where request_id = (select id from t_req)) = 1, 'двойной клик не создал дубль');
set role anon;

-- Другая студия с такими же id боксов не мешает (раньше мешала).
select pg_temp.ok((public.create_booking('other', 'wax', (select t10 from t_at), 'Иван', '+7 900 000-00-01') ->> 'boxId') = 'box-1',
  'студии изолированы: box-1 другой студии свободен');

-- Черновик не принимает записи.
select pg_temp.throws($$select public.create_booking('draft', 'wax', (select t10 from t_at), 'Иван', '+7 900 000-00-01')$$,
  'не опубликована', 'черновик не принимает записи');

-- Многодневная услуга: ppf-risk = 2 дня, держит бокс до закрытия 2-го дня.
create temp table t_multi as select public.create_booking('demo', 'ppf-risk', (select t10 from t_at) + interval '1 day', 'Сергей', '+7 900 000-00-06') as r;
grant select on t_multi to authenticated;
select pg_temp.ok(
  ((select r ->> 'endUtc' from t_multi)::timestamptz at time zone 'Europe/Moscow') = ((select d from t_at) + 2)::timestamp + time '18:00',
  '2-дневная работа заканчивается в 18:00 второго дня');
-- Вторая многодневная ложится на box-2, box-3 не принимает длинные.
select pg_temp.ok((public.create_booking('demo', 'ppf-risk', (select t10 from t_at) + interval '1 day', 'Ким', '+7 900 000-00-07') ->> 'boxId') = 'box-2',
  'вторая длинная работа → box-2');
select pg_temp.throws($$select public.create_booking('demo', 'ppf-risk', (select t10 from t_at) + interval '1 day', 'Лев', '+7 900 000-00-08')$$,
  'занято', 'box-3 не берёт многодневные: третья отклонена');
-- Во второй день box-1 и box-2 заняты, свободен только box-3.
select pg_temp.ok((public.create_booking('demo', 'wax', (select t10 from t_at) + interval '2 days', 'Ия', '+7 900 000-00-09') ->> 'boxId') = 'box-3',
  'второй день многодневной работы действительно занят');
select pg_temp.throws($$select public.create_booking('demo', 'wax', (select t10 from t_at) + interval '2 days', 'Ян', '+7 900 000-00-10')$$,
  'занято', 'во второй день нет свободных боксов');

-- Свободные окна под anon видят занятость.
select pg_temp.ok(not exists (
  select 1 from jsonb_array_elements(public.studio_free_slots('demo', 'wax', (select t10 from t_at) - interval '1 minute', (select t10 from t_at) + interval '1 minute') -> 'slots')
), 'studio_free_slots под anon не предлагает занятое 10:00');
select pg_temp.ok(jsonb_array_length(public.studio_free_slots('demo', 'wax', null, null, 5) -> 'slots') = 5, 'p_limit соблюдается');

-- Занятость без личных данных.
select pg_temp.ok((select count(*) from public.studio_busy('demo')) >= 7, 'studio_busy отдаёт интервалы');
select pg_temp.ok(not exists (
  select 1 from information_schema.routines r
  join information_schema.parameters p on p.specific_name = r.specific_name
  where r.routine_name = 'studio_busy' and p.parameter_name in ('contact_phone', 'contact_name')
), 'studio_busy без имён и телефонов');

-- Отмена одной записи не трогает остальные.
create temp table t_code as select r ->> 'code' as code from t_first;
grant select on t_code to anon;
select pg_temp.ok((public.cancel_booking('demo', (select code from t_code), '79000000005') ->> 'ok')::boolean, 'клиент отменил свою запись');
select pg_temp.ok((public.cancel_booking('demo', (select code from t_code), '79000000099') ->> 'ok')::boolean = false, 'чужой телефон не отменит');
reset role;
select pg_temp.ok((select count(*) from public.bookings where status = 'cancelled') = 1, 'отменена ровно одна запись (раньше — все)');
set role anon;

-- Напоминание: подписка по коду и телефону.
select pg_temp.ok((public.subscribe_reminder('demo', (select r ->> 'code' from t_multi), '+7 900 000-00-06',
  '{"endpoint":"https://push.example/abc","keys":{"p256dh":"k","auth":"a"}}') ->> 'ok')::boolean, 'подписка на напоминание за день');
select pg_temp.ok((public.subscribe_reminder('demo', (select r ->> 'code' from t_multi), '+7 000',
  '{"endpoint":"https://push.example/abc","keys":{"p256dh":"k","auth":"a"}}') ->> 'ok')::boolean = false, 'по чужому телефону подписаться нельзя');
select pg_temp.throws($$select * from public.reminders_due()$$, 'permission denied', 'anon не читает очередь напоминаний');

-- Служебное недоступно анонимно.
select pg_temp.throws($$select public.assistant_quota('demo', 'x')$$, 'permission denied', 'anon не вызывает assistant_quota');
select pg_temp.throws($$select public.insert_booking_core('demo', '{}'::jsonb, 'wax', now(), 'a', 'b', null, null, null, 'owner', false)$$, 'permission denied', 'anon не вызывает ядро записи в обход правил');
select pg_temp.throws($$select public.owner_bookings('demo', now(), now() + interval '9 days')$$, 'permission denied', 'anon не открывает кабинет');
select pg_temp.throws($$select public.assistant_context('demo')$$, 'permission denied', 'anon не вызывает assistant_context');

-- ===================== чужой владелец =====================
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000000b"}', true);
select pg_temp.throws($$select public.owner_bookings('demo', now(), now() + interval '9 days')$$, 'Нет доступа', 'владелец другой студии не видит записи demo');
select pg_temp.throws($$select public.owner_save_settings('demo', '{"name":"Взлом"}')$$, 'только владелец', 'и не меняет её настройки');
select pg_temp.ok((select count(*) from public.bookings where tenant_slug = 'demo') = 0, 'и не читает bookings demo напрямую');

-- ===================== владелец demo =====================
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000000a"}', true);
select pg_temp.ok((select count(*) from public.my_studios()) = 1, 'my_studios: одна студия');
create temp table t_list as select public.owner_bookings('demo', (select t10 from t_at) - interval '1 day', (select t10 from t_at) + interval '5 days') as j;
select pg_temp.ok(jsonb_array_length((select j from t_list)) >= 7, 'владелец видит записи за период');
select pg_temp.ok(
  (select count(*) from jsonb_array_elements((select j from t_list)) e where e ->> 'contact_phone' is not null) > 0,
  'в кабинете есть телефоны клиентов');
select pg_temp.ok(jsonb_array_length(public.owner_bookings('demo', (select t10 from t_at) + interval '2 days', (select t10 from t_at) + interval '2 days 1 hour')) >= 3,
  'двухдневная работа видна и во второй день');

-- Ручная запись владельцем в обход minNotice, но не в занятый бокс.
create temp table t_own as select public.owner_create_booking('demo', 'tint', (select t12 from t_at) + interval '2 hours', 'Постоянный', '+7 900 111-11-11') as r;
select pg_temp.ok((select r ->> 'code' from t_own) is not null, 'ручная запись владельцем создана');
select pg_temp.ok((select status from public.bookings where id = (select (r ->> 'id')::uuid from t_own)) = 'confirmed', 'ручная запись сразу подтверждена');

-- Статусы: принят → готов.
select pg_temp.ok((public.owner_set_status((select (r ->> 'id')::uuid from t_own), 'in_progress') ->> 'ok')::boolean, 'статус «принят в работу»');
select pg_temp.ok((public.owner_set_status((select (r ->> 'id')::uuid from t_own), 'done') ->> 'ok')::boolean, 'статус «готово»');

-- Оплата и возврат.
select pg_temp.ok((public.owner_add_payment((select (r ->> 'id')::uuid from t_own), 'payment', 100000, 'card') ->> 'paid')::int = 100000, 'оплата 1000 ₽ записана');
select pg_temp.throws($$select public.owner_add_payment((select (r ->> 'id')::uuid from t_own), 'refund', 200000)$$, 'Возврат больше', 'возврат больше оплаты запрещён');
select pg_temp.ok((public.owner_add_payment((select (r ->> 'id')::uuid from t_own), 'refund', 30000, 'cash', 'скидка') ->> 'paid')::int = 70000, 'возврат 300 ₽ записан');
select pg_temp.ok((public.owner_stats('demo', now() - interval '1 day', now() + interval '1 day') ->> 'received')::int = 70000, 'получено = оплаты − возвраты');
select pg_temp.ok((public.owner_stats('demo', (select t10 from t_at) - interval '1 day', (select t10 from t_at) + interval '5 days') ->> 'done')::int = 1, 'выполнено = 1');

-- Перенос: на занятое нельзя, на свободное можно.
select pg_temp.throws($$select public.owner_reschedule_booking((select (r ->> 'id')::uuid from t_multi), (select t10 from t_at))$$,
  'заняты', 'перенос в занятое время отклонён');
select pg_temp.ok((public.owner_reschedule_booking((select (r ->> 'id')::uuid from t_multi), (select t10 from t_at) + interval '5 days') ->> 'ok')::boolean, 'перенос на свободный день');

-- Настройки: белый список и формат.
select pg_temp.throws($$select public.owner_save_settings('demo', '{"slug":"hack"}')$$, 'нельзя менять', 'slug менять нельзя');
select pg_temp.throws($$select public.owner_save_settings('demo', '{"pwa":{}}')$$, 'нельзя менять', 'pwa менять нельзя');
select pg_temp.throws($$select public.owner_save_settings('demo', '{"services":[{"id":"a","name":"A","price":10.5,"durationMin":60}]}')$$, 'целым', 'дробная цена отклонена');
select pg_temp.throws($$select public.owner_save_settings('demo', '{"infoCards":[{"id":"a","title":"A"}]}')$$, 'ровно 3', 'нужно ровно 3 карточки');
select pg_temp.ok((public.owner_save_settings('demo', '{"name":"DETAILING 1808 ✓","closedDates":["2099-01-01"]}') ->> 'ok')::boolean, 'владелец сменил название');
select pg_temp.ok((public.owner_save_settings('demo', '{"phone":"+7 918 053-22-56"}') -> 'patch' ->> 'name') = 'DETAILING 1808 ✓', 'правки накапливаются, а не затирают друг друга');
update public.tenants set is_published = true, config = '{}' where slug in ('draft', 'demo');
reset role;
select pg_temp.ok((select not is_published from public.tenants where slug = 'draft'), 'владелец не может сам опубликовать студию');
select pg_temp.ok((select config <> '{}' from public.tenants where slug = 'demo'), 'и не может затереть конфиг в обход проверки');
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000000a"}', true);
select pg_temp.throws($$insert into public.tenant_settings (tenant_slug, patch) values ('demo', '{"slug":"x"}') on conflict (tenant_slug) do update set patch = excluded.patch$$,
  'row-level security', 'прямой upsert tenant_settings мимо проверки закрыт');

-- ===================== посетитель видит правки =====================
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_temp.ok((public.studio_patch('demo') ->> 'name') = 'DETAILING 1808 ✓', 'посетитель видит правки владельца');
select pg_temp.ok(public.studio_patch('draft') is null, 'правки черновика не видны');
-- closedDates закрывает день.
reset role;
select pg_temp.ok(public.studio_hours_for('{"hours":[{"day":4,"open":"10:00","close":"18:00"}],"closedDates":["2099-01-01"]}', '2099-01-01') = '{}'::jsonb, 'closedDates закрывает день');

rollback;
\echo 'ВСЕ ПРОВЕРКИ БАЗЫ ПРОЙДЕНЫ'
