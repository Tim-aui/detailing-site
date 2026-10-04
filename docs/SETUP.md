# Запуск и публикация

Сайт записи — одно приложение для любого числа студий. Каждая студия —
папка `tenants/<slug>/` (файл `studio.json` + `photos/`) и адрес
`/s/<slug>/`. Код для новой студии менять не нужно.

## 1. Локально

```bash
pnpm install
pnpm dev            # сначала tenant:sync, потом vite → http://localhost:5173/s/demo/
pnpm test           # интерфейс и расписание (vitest)
pnpm test:db        # SQL-тесты и гонка двойной записи (нужен локальный PostgreSQL)
pnpm test:e2e       # Playwright: телефон и компьютер
```

Без `.env.local` сайт работает на данных из файла: записи сохраняются в
браузере, кабинет показывает, что ему нужна база.

## 2. Supabase

```bash
pnpm supabase login
pnpm supabase link --project-ref <ref>
pnpm supabase db push                       # миграции supabase/migrations/*
pnpm supabase functions deploy assistant --no-verify-jwt
pnpm supabase functions deploy reminders --no-verify-jwt
```

`--no-verify-jwt`: функции сами проверяют доступ (помощник владельца —
по токену и `can_manage_tenant`, напоминания — по `CRON_SECRET`).

### Секреты функций

```bash
pnpm supabase secrets set \
  OPENAI_API_KEY=sk-... \
  OPENAI_MODEL=gpt-4.1-mini \
  ASSISTANT_SALT=$(openssl rand -hex 16) \
  VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com \
  CRON_SECRET=$(openssl rand -hex 24)
```

| Переменная | По умолчанию | Смысл |
|---|---|---|
| `OPENAI_MODEL` | `gpt-4.1-mini` | модель помощника — меняется без пересборки сайта |
| `OPENAI_BASE_URL` | — | совместимый шлюз (прокси, Azure, локальная модель) |
| `ASSISTANT_ACTOR_LIMIT` | 20 | вопросов в час с одного адреса (клиент) |
| `ASSISTANT_OWNER_LIMIT` | 60 | вопросов в час владельцу |
| `ASSISTANT_TENANT_DAILY` | 300 | вопросов в сутки на студию |
| `ASSISTANT_DAILY_TOKENS` | 400000 | потолок токенов в сутки на весь проект — предел счёта за модель |
| `ASSISTANT_MAX_TOKENS` | 400 | длина одного ответа |

Ключи базы и модели живут только в секретах функций и `.env.local` —
в код сайта попадают лишь публичные `VITE_*`.

## 3. Напоминания

Клиент после записи нажимает «Напомнить за день». Где браузер умеет
push (Android, компьютер, iPhone с сайтом на экране «Домой»), сервер
пришлёт уведомление за сутки (или за 2 часа, если до визита меньше
суток). Где не умеет — кнопка «Добавить в календарь» (.ics с
напоминаниями за день и за 2 часа).

1. Ключи: `npx web-push generate-vapid-keys`.
2. Публичный ключ — в `VITE_VAPID_PUBLIC_KEY` (Vercel → Environment
   Variables), оба ключа и `VAPID_SUBJECT` — в секреты функций (см. выше).
3. Расписание раз в 15 минут (Supabase → SQL Editor, расширения
   `pg_cron` и `pg_net` включаются в Database → Extensions):

```sql
select cron.schedule(
  'studio-reminders', '*/15 * * * *',
  $$ select net.http_post(
       url     := 'https://<ref>.supabase.co/functions/v1/reminders',
       headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>',
                                     'Content-Type', 'application/json'),
       body    := '{}'::jsonb) $$
);
```

## 4. Vercel

```bash
npx vercel link
npx vercel env add VITE_SUPABASE_URL
npx vercel env add VITE_SUPABASE_ANON_KEY
npx vercel env add VITE_VAPID_PUBLIC_KEY
npx vercel --prod
```

`vercel.json` уже содержит сборку (`tenant:sync` → `build`), переписывание
путей `/s/*` на приложение и заголовки для service worker.

### База через свой адрес (/sb) — для России

У части российских провайдеров `*.supabase.co` недоступен. `vercel.json`
пересылает `https://<сайт>/sb/*` в Supabase, поэтому браузеру клиента
достаточно доступа к самому сайту. Включается переменной в Vercel:

    VITE_SUPABASE_URL=/sb        (Production и Preview, затем Redeploy)

Если у вас другой проект Supabase, поменяйте адрес в первом rewrite
`vercel.json`. Откат: вернуть `VITE_SUPABASE_URL=https://<ref>.supabase.co`
и сделать Redeploy. В `.env.local` для скриптов `tenant:*` остаётся полный
адрес. После переключения владельцу нужно один раз войти в кабинет заново.
`pnpm tenant:verify` проверяет и этот путь («База через сайт (/sb)»).

### ИИ-помощник для клиентов

По умолчанию выключен: на главной его нет, сервер на вопросы клиентов не
отвечает и модель не тратит. Включить помощника:
`"assistantEnabled": true` в `tenants/<slug>/studio.json` → `pnpm tenant:push`
→ push. Помощник в кабинете владельца работает всегда.

## 5. Новая студия — за несколько минут

```bash
pnpm tenant:new --slug moya-studiya --name "Моя студия"   # папка-образец
# 1) правим tenants/moya-studiya/studio.json: название, телефон, адрес,
#    часы, услуги (цена в копейках), боксы, 3 карточки,
#    legal: operator («ИП Иванов И. И.»), inn, email — для политики /s/<slug>/privacy
# 2) кладём фото в tenants/moya-studiya/photos/ (hero + работы)
pnpm tenant:validate --slug moya-studiya     # схема, фото, услуги, боксы
pnpm tenant:publish  --slug moya-studiya     # снимает метку образца
pnpm tenant:push     --slug moya-studiya     # настройки → база (сервер сверяет цены)
pnpm tenant:owner    --slug moya-studiya --email owner@mail.ru   # вход в кабинет
git add tenants/moya-studiya && git commit -m "Студия moya-studiya" && git push   # Vercel соберёт
pnpm tenant:verify   --slug moya-studiya --url https://<сайт> --assistant
```

Короткая ссылка `https://<сайт>/` ведёт на студию из `tenants/root-slug.txt`
(одно слово, например `demo`). Без файла — на первую опубликованную по алфавиту,
поэтому новая студия могла бы «перехватить» корень — файл это фиксирует.

До `tenant:publish` студия открывается только как образец: страница
показывает «Студия ещё не опубликована», сервер записи не принимает.

После публикации владелец правит всё сам в кабинете `/s/<slug>/admin`:
услуги, цены, длительность, боксы, часы, выходные, адрес, телефон, логотип,
главное фото, 3 карточки и фото работ. Эти правки хранятся в базе
(`tenant_settings.patch`) и не затираются повторным `tenant:push`.

### Пароль и почта владельца

```bash
# новый пароль (старый перестаёт работать сразу)
pnpm tenant:owner --slug moya-studiya --email owner@mail.ru --password 'Новый-пароль-2026'
# новая почта для входа (записи, настройки и доступ сохраняются)
pnpm tenant:owner --slug moya-studiya --email owner@mail.ru --new-email novaya@mail.ru
# почта и пароль разом
pnpm tenant:owner --slug moya-studiya --email owner@mail.ru --new-email novaya@mail.ru --password 'Новый-пароль-2026'
# второй вход (менеджер) и отключение доступа
pnpm tenant:owner --slug moya-studiya --email manager@mail.ru --role manager
pnpm tenant:owner --slug moya-studiya --email manager@mail.ru --remove
```

Нужен `SUPABASE_SERVICE_ROLE_KEY` в `.env.local`. Письма не отправляются,
подтверждать почту не нужно. Владельцу, который уже вошёл, после смены
пароля или почты надо войти заново.

## 6. Проверка базы локально (без Docker)

`supabase/tests/run.sh` создаёт базу `studio_test` в локальном
PostgreSQL, накатывает заглушку Supabase (`supabase_stub.sql`) и все
миграции, затем гоняет `booking_test.sql` (изоляция студий, права,
атомарность, отмена, оплаты, напоминания). `race.sh` запускает 20
параллельных записей на одно время и проверяет, что прошла ровно одна.
