# Применение исправлений из FIXES.md (23.10.2026)

Код и миграции в репозитории. На прод они попадут только после шагов ниже:
сессия, в которой готовились правки, не имела доступа к Supabase и npm.

## 0. До применения

```bash
pnpm install
pnpm typecheck           # не прогонялся при подготовке — npm был недоступен
pnpm test                # vitest
pnpm test:db             # SQL-тесты + гонки: прогнаны, проходят
pnpm build               # проверьте, что в dist/s/bro-100/index.html есть og:title
```

Сверьте прод со схемой в репо: если функции правились руками в SQL Editor,
`create or replace` из новых миграций перезапишет эти правки.

```bash
pnpm supabase db diff --linked     # пусто = прод совпадает с миграциями
```

## 1. База

```bash
pnpm supabase db push
```

Новые миграции:

| Файл | Что делает |
|---|---|
| `20261023000000_security_hardening.sql` | tenants/tenant_settings закрыты от anon; у anon нет прав ни на одну таблицу; `studio_config` снят с anon; код записи 8 символов; лимиты частоты; запрет записи в прошлое; `search_path = public, pg_temp` у всех SECURITY DEFINER; права на функции заново |
| `20261023000100_owner_notifications.sql` | Telegram: таблица `tenant_notify`, RPC кабинета и бота, триггер `bookings_notify_owner` (pg_net) |
| `20261023000200_settings_legal_metrika.sql` | `owner_save_settings` принимает `legal` и `metrikaId` с проверкой ИНН/ОГРН |

## 2. Функции и секреты

См. docs/NOTIFICATIONS.md: бот, секреты, `functions deploy telegram --no-verify-jwt`,
Vault, setWebhook.

## 3. Vercel

Переменные (Production и Preview), затем Redeploy:

- `VITE_TELEGRAM_BOT_USERNAME` — имя бота без @
- `VITE_VAPID_PUBLIC_KEY` — если включаете push-напоминания
- `SITE_URL=https://zapisbox.vercel.app` — для og:image/canonical/sitemap
  (без неё берётся `VERCEL_PROJECT_PRODUCTION_URL`, иначе zapisbox.vercel.app)

`vercel.json` не требует правок для страниц студий: Vercel сначала отдаёт
файл (`dist/s/<slug>/index.html`), rewrite на `/index.html` срабатывает,
только если файла нет.

## 4. Руками в Supabase (блок 6)

- Пароль `admin@mail.ru`: `pnpm tenant:owner --slug <slug> --email admin@mail.ru --password '<новый, 16+ символов>'`
- Authentication → Sign In / Providers → выключить «Allow new users to sign up».
- Database → Backups: включить PITR (платный тариф).
- Перевыпустить персональный токен `sbp_…` из `scripts/apply-migrations.mjs`
  (лежит открытым текстом; файл в .gitignore, но токен даёт полный доступ к проекту).
- Мониторинг: `.github/workflows/uptime.yml` — добавьте 4 секрета репозитория (описаны в файле). Работает, только если репо на GitHub.

## 5. Демо-данные (блок 5)

`supabase/scripts/seed_demo.sql` — только для демо-студии: демо-записи
занимают боксы. Студия задаётся в первой строке (`v_slug`), очистка — внизу
файла.

## 6. Приёмка

Скрипт из FIXES.md. Ожидаемые отличия:

- п.1 `tenants` для anon → **401** (`permission denied`), не `[]`.
- п.6 лимит `my_bookings`: 20 вызовов в час на один номер, 60 за 10 минут
  с одного IP. 40 быстрых вызовов с одним номером → с 21-го ответ не 200.
- п.4 после теста отмените запись (`cancel_booking`): тестовая запись
  попадёт и в Telegram владельцу, если чат уже подключён.
