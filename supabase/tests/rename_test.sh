#!/bin/bash
# Проверка supabase/scripts/rename_studio.sql на локальной БД:
#  1) обычный перенос demo → 1808-detailing со всеми данными;
#  2) повторный запуск ничего не ломает;
#  3) tenant:push сделали раньше скрипта (пустая копия) — скрипт её убирает;
#  4) у «новой» студии свои данные — скрипт останавливается и ничего не меняет.
set -e
cd "$(dirname "$0")/../.."
DB=${DB:-studio_rename_test}
PSQL=${PSQL:-"sudo -u postgres psql -q -v ON_ERROR_STOP=1"}
NEW=1808-detailing
SCRIPT=supabase/scripts/rename_studio.sql

# Конфиг «как в боевой базе до переименования»: slug demo, без previousSlugs.
CFG=$(node --no-warnings --experimental-strip-types scripts/tenant-json.ts tenants/$NEW/studio.json \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s);c.slug="demo";delete c.previousSlugs;process.stdout.write(JSON.stringify(c))})')

fresh() {
  $PSQL -c "drop database if exists $DB" -c "create database $DB" >/dev/null 2>&1
  $PSQL -d $DB < supabase/tests/supabase_stub.sql >/dev/null
  for f in supabase/migrations/*.sql; do $PSQL -d $DB < "$f" 2>&1 >/dev/null | grep -v "does not exist, skipping" || true; done
  $PSQL -d $DB -v cfg="$CFG" >/dev/null <<'SQL'
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@1808.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'owner@as.test');
insert into public.tenants (slug, name, config, is_published)
values ('demo', 'DETAILING 1808', :'cfg'::jsonb, true),
       ('as-tuning', 'AS Tuning', jsonb_set(:'cfg'::jsonb, '{slug}', '"as-tuning"'), true);
insert into public.tenant_members (tenant_slug, user_id) values
  ('demo', '00000000-0000-0000-0000-0000000000a1'),
  ('as-tuning', '00000000-0000-0000-0000-0000000000b2');
insert into public.staff_members (tenant_slug, user_id, full_name) values
  ('demo', '00000000-0000-0000-0000-0000000000a1', 'Мастер');
insert into public.tenant_settings (tenant_slug, patch) values
  ('demo', '{"phone":"+7 999 111-22-33","logo":"https://x/storage/v1/object/public/studio-media/demo/logo.jpg"}');
select public.create_booking('demo', 'wax', ((current_date + 3)::timestamp + time '10:00') at time zone 'Europe/Moscow', 'Иван', '+7 900 000-00-01', 'BMW');
select public.create_booking('demo', 'wax', ((current_date + 4)::timestamp + time '12:00') at time zone 'Europe/Moscow', 'Пётр', '+7 900 000-00-02', 'Audi');
select public.create_booking('as-tuning', 'wax', ((current_date + 3)::timestamp + time '10:00') at time zone 'Europe/Moscow', 'Сосед', '+7 900 000-00-09', 'Kia');
insert into public.payments (tenant_slug, booking_id, kind, amount)
  select 'demo', id, 'payment', 350000 from public.bookings where tenant_slug = 'demo' limit 1;
insert into public.booking_reminders (tenant_slug, booking_id, endpoint, p256dh, auth, remind_at)
  select 'demo', id, 'https://push/x', 'k', 'a', now() + interval '1 day' from public.bookings where tenant_slug = 'demo' limit 1;
insert into public.assistant_usage (tenant_slug, actor, question) values ('demo', 'x', 'q');
SQL
}

counts() {
  $PSQL -d $DB -tA <<'SQL'
select string_agg(format('%s=%s', t, n), ' ' order by t) from (
  select 'tenants:'||slug t, 1 n from public.tenants
  union all select 'bookings:'||tenant_slug, count(*) from public.bookings group by tenant_slug
  union all select 'members:'||tenant_slug, count(*) from public.tenant_members group by tenant_slug
  union all select 'staff:'||tenant_slug, count(*) from public.staff_members group by tenant_slug
  union all select 'settings:'||tenant_slug, count(*) from public.tenant_settings group by tenant_slug
  union all select 'payments:'||tenant_slug, count(*) from public.payments group by tenant_slug
  union all select 'reminders:'||tenant_slug, count(*) from public.booking_reminders group by tenant_slug
  union all select 'usage:'||tenant_slug, count(*) from public.assistant_usage group by tenant_slug
) x;
SQL
}
fail() { echo "FAIL: $*"; exit 1; }
run() { $PSQL -d $DB -o /dev/null < $SCRIPT 2>&1 | sed -E 's/^.*NOTICE:  //'; }

# ---------- 1. обычный перенос ----------
fresh
BEFORE=$(counts)
OUT=$(run)
AFTER=$(counts)
echo "$OUT" | sed 's/^/   /'
EXPECT=$(echo "$BEFORE" | sed "s/:demo=/:$NEW=/g" | tr ' ' '\n' | sort | tr '\n' ' ')
GOT=$(echo "$AFTER" | tr ' ' '\n' | sort | tr '\n' ' ')
[ "$EXPECT" = "$GOT" ] || fail "строки не совпали: было [$BEFORE], стало [$AFTER]"
echo "ok  все данные переехали: $AFTER"

CHK=$($PSQL -d $DB -tA -c "select config->>'slug', config->'previousSlugs'->>0, is_published, name from public.tenants where slug='$NEW'")
[ "$CHK" = "$NEW|demo|t|DETAILING 1808" ] || fail "строка студии: $CHK"
echo "ok  конфиг: slug=$NEW, previousSlugs=[demo], опубликована, имя то же"

# Запись на новый адрес работает; занятость старых записей учитывается.
$PSQL -d $DB -tA -c "select public.create_booking('$NEW', 'wax', ((current_date + 5)::timestamp + time '10:00') at time zone 'Europe/Moscow', 'Новый', '+7 900 000-00-05', 'VW') ->> 'boxId'" | grep -q box- \
  || fail "create_booking на новом адресе"
echo "ok  create_booking('$NEW', …) работает"
ERR=$($PSQL -d $DB -tA -c "select public.create_booking('$NEW', 'wax', ((current_date + 3)::timestamp + time '15:00') at time zone 'Europe/Moscow', 'Иван', '+7 900 000-00-01', 'BMW')" 2>&1 || true)
echo "$ERR" | grep -qi "уже есть запись\|already" || fail "правило «один телефон в день» не видит перенесённую запись: $ERR"
echo "ok  перенесённые записи учитываются (тот же телефон в тот же день — отказ)"
ERR=$($PSQL -d $DB -tA -c "select public.create_booking('demo', 'wax', ((current_date + 6)::timestamp + time '10:00') at time zone 'Europe/Moscow', 'X', '+7 900 000-00-06')" 2>&1 || true)
echo "$ERR" | grep -q ERROR || fail "старый адрес в базе всё ещё принимает записи"
echo "ok  старого адреса в базе больше нет"

# ---------- 2. повторный запуск ----------
OUT=$(run); AGAIN=$(counts)
echo "$OUT" | grep -q "Уже переименовано" || fail "повтор: $OUT"
echo "ok  повторный запуск: «Уже переименовано», ничего не изменилось"

# ---------- 3. tenant:push сделали раньше SQL ----------
fresh
echo "insert into public.tenants (slug, name, config, is_published) values ('$NEW', 'DETAILING 1808', jsonb_set(:'cfg'::jsonb, '{slug}', '\"$NEW\"'), true)" | $PSQL -d $DB -v cfg="$CFG" >/dev/null
OUT=$(run)
echo "$OUT" | grep -q "Убрал пустую копию" || fail "пустая копия: $OUT"
counts | grep -q "bookings:$NEW=2" || fail "после пустой копии: $(counts)"
echo "ok  пустая копия от раннего tenant:push убрана, данные перенесены"

# ---------- 4. у «новой» студии свои данные ----------
fresh
echo "insert into public.tenants (slug, name, config, is_published) values ('$NEW', 'X', jsonb_set(:'cfg'::jsonb, '{slug}', '\"$NEW\"'), true)" | $PSQL -d $DB -v cfg="$CFG" >/dev/null
$PSQL -d $DB -c "select public.create_booking('$NEW', 'wax', ((current_date + 3)::timestamp + time '10:00') at time zone 'Europe/Moscow', 'Чужой', '+7 900 000-00-07')" >/dev/null
BEFORE=$(counts)
OUT=$($PSQL -d $DB -o /dev/null < $SCRIPT 2>&1 || true)
echo "$OUT" | grep -q "со своими данными" || fail "конфликт не пойман: $OUT"
[ "$BEFORE" = "$(counts)" ] || fail "при конфликте что-то изменилось"
echo "ok  конфликт: остановился, ничего не изменил"

$PSQL -c "drop database if exists $DB" >/dev/null 2>&1
echo "ПЕРЕИМЕНОВАНИЕ ПРОВЕРЕНО"
