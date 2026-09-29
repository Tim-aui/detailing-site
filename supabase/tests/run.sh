#!/bin/bash
# Локальный прогон проверок базы: чистая БД → миграции → booking_test.sql.
# Нужны: Postgres 15+ и права sudo -u postgres (или задайте PSQL).
set -e
cd "$(dirname "$0")/../.."
DB=${DB:-studio_test}
PSQL=${PSQL:-"sudo -u postgres psql -q -v ON_ERROR_STOP=1"}
$PSQL -c "drop database if exists $DB" -c "create database $DB" >/dev/null 2>&1
$PSQL -d $DB < supabase/tests/supabase_stub.sql >/dev/null
for f in supabase/migrations/*.sql; do $PSQL -d $DB < "$f" 2>&1 >/dev/null | grep -v "does not exist, skipping" || true; done
CFG=$(node --experimental-strip-types scripts/tenant-json.ts tenants/demo/studio.json)
$PSQL -d $DB -v democfg="$CFG" -o /dev/null < supabase/tests/booking_test.sql 2>&1 | sed -E "s/^(psql:)?[^N]*NOTICE:  //" | grep -v "does not exist, skipping"
