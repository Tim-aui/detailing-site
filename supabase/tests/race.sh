#!/bin/bash
# Гонка: N параллельных соединений записываются на одно время.
# Ожидание: занято ровно столько боксов, сколько есть (3), остальные
# получают «уже занято». Плюс 10 параллельных «двойных кликов» с одним
# request_id — в базе ровно одна запись.
set -e
cd "$(dirname "$0")/../.."
DB=${DB:-studio_test}
PSQL=${PSQL:-"sudo -u postgres psql -q -X -t -A"}
CFG=$(node --experimental-strip-types scripts/tenant-json.ts tenants/demo/studio.json)
$PSQL -d $DB -c "truncate public.bookings, public.tenants cascade" 2>/dev/null >/dev/null
$PSQL -d $DB -v cfg="$CFG" <<'SQL' >/dev/null
insert into public.tenants (slug, name, config, is_published) values ('demo', 'Demo', :'cfg'::jsonb, true);
SQL
T=$($PSQL -d $DB -c "select ((((now() at time zone 'Europe/Moscow')::date + 4)::timestamp + time '10:00') at time zone 'Europe/Moscow')")
N=${N:-20}
tmp=$(mktemp -d)
for i in $(seq 1 $N); do
  ( $PSQL -d $DB -c "set role anon; select public.create_booking('demo','polish','$T','Гонщик $i','+7 900 555-00-$(printf %02d $i)') ->> 'boxId'" >"$tmp/$i.out" 2>"$tmp/$i.err" || true ) &
done
wait
ok=$(cat $tmp/*.out | grep -c box || true)
busy=$(cat $tmp/*.err | grep -c "занят" || true)
rows=$($PSQL -d $DB -c "select count(*) from public.bookings where starts_at = '$T'")
echo "гонка: $N запросов → успешно $ok, «занято» $busy, строк в базе $rows (боксов 3)"
[ "$ok" = "3" ] && [ "$rows" = "3" ] || { echo "FAIL"; cat $tmp/*.err | sort | uniq -c; exit 1; }

REQ=$(cat /proc/sys/kernel/random/uuid)
T2=$($PSQL -d $DB -c "select '$T'::timestamptz + interval '1 day'")
for i in $(seq 1 10); do
  ( $PSQL -d $DB -c "set role anon; select public.create_booking('demo','wax','$T2','Двойной','+7 900 777-00-00','', '', '$REQ') ->> 'code'" >"$tmp/r$i.out" 2>&1 || true ) &
done
wait
codes=$(cat $tmp/r*.out | sort -u | wc -l)
rows=$($PSQL -d $DB -c "select count(*) from public.bookings where request_id = '$REQ'")
echo "двойной клик: 10 параллельных повторов → разных кодов $codes, строк $rows"
[ "$codes" = "1" ] && [ "$rows" = "1" ] || { echo "FAIL"; cat $tmp/r*.out; exit 1; }
rm -rf "$tmp"
echo "ГОНКИ ПРОЙДЕНЫ"
