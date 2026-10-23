# Уведомления

## Владельцу — Telegram

Новая запись (с сайта или из кабинета) и отмена клиентом приходят в чат
владельца. Под сообщением кнопки «Подтвердить» / «Отменить» и ссылка на
кабинет. Отмены, сделанные самим владельцем в кабинете, не дублируются.

Схема: триггер `bookings_notify_owner` → `pg_net` → Edge Function
`telegram` → Bot API. Чат к студии привязывается по одноразовой ссылке,
chat id руками вводить не нужно.

### Настройка (один раз на проект)

1. **Бот.** @BotFather → `/newbot` → получите токен и имя бота.
2. **Секреты функции:**

   ```bash
   NOTIFY_SECRET=$(openssl rand -hex 24)
   WEBHOOK_SECRET=$(openssl rand -hex 24)
   pnpm supabase secrets set \
     TELEGRAM_BOT_TOKEN=<токен> \
     TELEGRAM_WEBHOOK_SECRET=$WEBHOOK_SECRET \
     NOTIFY_SECRET=$NOTIFY_SECRET \
     SITE_URL=https://zapisbox.vercel.app
   pnpm supabase functions deploy telegram --no-verify-jwt
   ```

   `--no-verify-jwt` обязателен: Telegram не присылает токен Supabase.
   Функция сама проверяет заголовок `x-telegram-bot-api-secret-token`
   (Telegram) или `x-notify-secret` (база).

3. **Vault** (Supabase → SQL Editor). Тот же `NOTIFY_SECRET`, что выше:

   ```sql
   select vault.create_secret('https://<ref>.supabase.co/functions/v1/telegram', 'telegram_notify_url');
   select vault.create_secret('<NOTIFY_SECRET>', 'telegram_notify_secret');
   ```

   Пока секретов нет, триггер молча ничего не отправляет — записи это не
   ломает.

4. **Webhook бота:**

   ```bash
   curl "https://api.telegram.org/bot<токен>/setWebhook" \
     -d url=https://<ref>.supabase.co/functions/v1/telegram \
     -d secret_token=$WEBHOOK_SECRET \
     -d 'allowed_updates=["message","callback_query"]'
   ```

5. **Vercel:** `VITE_TELEGRAM_BOT_USERNAME=<имя_бота>` (без @) → Redeploy.

### Подключение студии

Владелец: кабинет → Настройки → Основное → «Уведомления в Telegram» →
«Подключить Telegram» → в боте «Старт». Ссылка действует час и
срабатывает один раз. Статус в кабинете обновится при возврате на вкладку.

### Проверка

Запись через публичную форму → сообщение в Telegram в пределах
нескольких секунд. Если не пришло:

```sql
-- ответы pg_net за последние минуты
select id, status_code, content, created from net._http_response order by created desc limit 5;
```

и логи функции `telegram` в Supabase → Edge Functions → Logs.

## Клиенту — напоминание за день

Работает через web push (функция `reminders`, таблица
`booking_reminders`). В собранном бандле проверка выглядела как `… && !1`:
это не «выключено в коде», а пустая переменная `VITE_VAPID_PUBLIC_KEY`
на Vercel — Vite подставил пустую строку, минификатор свернул её в `false`.

Включить: шаги из docs/SETUP.md, раздел «Напоминания» (ключи VAPID,
секреты, `functions deploy reminders --no-verify-jwt`, cron) и
`VITE_VAPID_PUBLIC_KEY` в Vercel → Redeploy.

Ограничение: на iPhone push работает только если сайт добавлен на экран
«Домой». Для остальных остаётся .ics-файл с напоминанием. Надёжный канал
для всех — напоминания через Telegram-бота или SMS; это следующий шаг.
