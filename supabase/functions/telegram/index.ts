/**
 * Edge Function: telegram — уведомления владельцу и бот студии.
 *
 * Два входа в одной функции:
 *   1. От базы (триггер bookings_notify_owner через pg_net):
 *        POST {event: 'created' | 'cancelled', bookingId}
 *        заголовок x-notify-secret: NOTIFY_SECRET
 *      → сообщение в чат студии. Чат не подключён — тихий выход (200).
 *   2. От Telegram (webhook):
 *        заголовок x-telegram-bot-api-secret-token: TELEGRAM_WEBHOOK_SECRET
 *      → /start <токен> привязывает чат к студии;
 *        кнопки «Подтвердить» / «Отменить» меняют статус записи.
 *
 * Секреты функции (supabase secrets set …):
 *   TELEGRAM_BOT_TOKEN       — токен от @BotFather. В бандл сайта не попадает.
 *   TELEGRAM_WEBHOOK_SECRET  — случайная строка, её же передаём в setWebhook.
 *                              Ею же подписываются кнопки.
 *   NOTIFY_SECRET            — случайная строка, та же лежит в Vault
 *                              (telegram_notify_secret) для триггера.
 *   SITE_URL                 — https://zapisbox.vercel.app (ссылка на кабинет).
 *
 * Деплой без проверки JWT: Telegram не присылает токен Supabase.
 *   supabase functions deploy telegram --no-verify-jwt
 * Подробно — docs/NOTIFICATIONS.md.
 */
import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {formatInTimeZone} from 'npm:date-fns-tz@3.2.0';
import {ru} from 'npm:date-fns@4.4.0/locale';

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? '';
const NOTIFY_SECRET = Deno.env.get('NOTIFY_SECRET') ?? '';
const SITE_URL = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '');

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: {persistSession: false},
});

type Booking = {
  id: string;
  code: string;
  tenantSlug: string;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  status: 'pending' | 'confirmed' | 'in_progress' | 'done' | 'cancelled';
  price: number;
  source: 'client' | 'owner';
  name: string;
  phone: string;
  car: string;
  comment: string;
  studioName: string;
  timezone: string;
  chatId: number | null;
};

// ---------------------------------------------------------------------------
// Вспомогательное
// ---------------------------------------------------------------------------

/** Сравнение секретов за постоянное время. */
function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sign(text: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(WEBHOOK_SECRET),
    {name: 'HMAC', hash: 'SHA-256'},
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
  return Array.from(mac.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** +7 918 123-45-67 — Telegram сам делает номер кликабельным в приложении. */
function prettyPhone(raw: string): string {
  const d = raw.replace(/\D/g, '');
  const ten = d.length >= 10 ? d.slice(-10) : '';
  if (!ten) return raw;
  return `+7 ${ten.slice(0, 3)} ${ten.slice(3, 6)}-${ten.slice(6, 8)}-${ten.slice(8)}`;
}

function rub(kopecks: number): string {
  return `${Math.round(kopecks / 100).toLocaleString('ru-RU')} ₽`;
}

const STATUS_LINE: Record<Booking['status'], string> = {
  pending: '⏳ Ждёт подтверждения',
  confirmed: '✅ Подтверждена',
  in_progress: '🔧 В работе',
  done: '🏁 Готово',
  cancelled: '✖️ Отменена',
};

function bookingText(b: Booking, headline: string): string {
  const when = formatInTimeZone(new Date(b.startsAt), b.timezone, "EEEEEE, d MMMM 'в' HH:mm", {locale: ru});
  const lines = [
    `<b>${esc(headline)}</b> · ${esc(b.studioName)}`,
    '',
    `🛠 ${esc(b.serviceName)}`,
    `📅 ${esc(when)}`,
    `👤 ${esc(b.name)}`,
    `📞 ${esc(prettyPhone(b.phone))}`,
    b.car ? `🚗 ${esc(b.car)}` : null,
    b.comment ? `💬 ${esc(b.comment)}` : null,
    `💰 ${rub(b.price)}`,
    `Источник: ${b.source === 'owner' ? 'добавлена в кабинете' : 'сайт'} · код ${esc(b.code)}`,
    '',
    STATUS_LINE[b.status],
  ];
  return lines.filter((l) => l !== null).join('\n');
}

async function keyboard(b: Booking) {
  const row: Array<{text: string; callback_data?: string; url?: string}> = [];
  if (b.status === 'pending') row.push({text: '✅ Подтвердить', callback_data: `c:${b.id}:${await sign(`c:${b.id}`)}`});
  if (b.status === 'pending' || b.status === 'confirmed') {
    row.push({text: '✖️ Отменить', callback_data: `x:${b.id}:${await sign(`x:${b.id}`)}`});
  }
  const rows = row.length ? [row] : [];
  if (SITE_URL) rows.push([{text: 'Открыть кабинет', url: `${SITE_URL}/s/${b.tenantSlug}/admin/`}]);
  return {inline_keyboard: rows};
}

async function tg(method: string, body: unknown) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) console.error(`telegram ${method} failed`, res.status, JSON.stringify(data));
  return data;
}

async function loadBooking(id: string): Promise<Booking | null> {
  const {data, error} = await db.rpc('telegram_booking', {p_booking_id: id});
  if (error) throw new Error(error.message);
  return (data as Booking | null) ?? null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
}

// ---------------------------------------------------------------------------
// 1. Событие из базы
// ---------------------------------------------------------------------------

async function handleNotify(payload: {event?: string; bookingId?: string}) {
  if (!payload.bookingId || !['created', 'cancelled'].includes(payload.event ?? '')) {
    return json({ok: false, error: 'bad payload'}, 400);
  }
  const b = await loadBooking(payload.bookingId);
  // Чат не подключён или запись исчезла — тихо выходим.
  if (!b || !b.chatId) return json({ok: true, skipped: true});

  const headline = payload.event === 'cancelled' ? 'Клиент отменил запись' : 'Новая запись';
  await tg('sendMessage', {
    chat_id: b.chatId,
    text: bookingText(b, headline),
    parse_mode: 'HTML',
    link_preview_options: {is_disabled: true},
    reply_markup: payload.event === 'cancelled' ? undefined : await keyboard(b),
  });
  return json({ok: true});
}

// ---------------------------------------------------------------------------
// 2. Webhook Telegram
// ---------------------------------------------------------------------------

type Update = {
  message?: {chat: {id: number}; text?: string};
  callback_query?: {
    id: string;
    data?: string;
    message?: {chat: {id: number}; message_id: number};
  };
};

async function handleStart(chatId: number, text: string) {
  const token = text.split(/\s+/)[1] ?? '';
  if (!/^[a-f0-9]{32}$/.test(token)) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: 'Здравствуйте! Чтобы получать сюда записи студии, откройте кабинет → Настройки → «Уведомления» и нажмите «Подключить Telegram».',
    });
    return;
  }
  const {data, error} = await db.rpc('telegram_bind', {p_token: token, p_chat_id: chatId});
  if (error) throw new Error(error.message);
  if (!data?.ok) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: 'Ссылка устарела или уже использована. Получите новую в кабинете: Настройки → «Уведомления».',
    });
    return;
  }
  await tg('sendMessage', {
    chat_id: chatId,
    text: `Готово: новые записи и отмены «${data.name}» будут приходить сюда. Подтверждать и отменять можно кнопками под сообщением.`,
  });
}

async function handleCallback(q: NonNullable<Update['callback_query']>) {
  const chatId = q.message?.chat.id;
  const [action, id, sig] = (q.data ?? '').split(':');
  if (!chatId || !id || !sig || !['c', 'x'].includes(action) || !safeEqual(sig, await sign(`${action}:${id}`))) {
    await tg('answerCallbackQuery', {callback_query_id: q.id, text: 'Кнопка недействительна'});
    return;
  }

  const {data, error} = await db.rpc('telegram_set_status', {
    p_booking_id: id,
    p_chat_id: chatId,
    p_status: action === 'c' ? 'confirmed' : 'cancelled',
  });
  if (error) throw new Error(error.message);

  await tg('answerCallbackQuery', {
    callback_query_id: q.id,
    text: data?.ok ? (action === 'c' ? 'Запись подтверждена' : 'Запись отменена') : (data?.reason ?? 'Не получилось'),
  });

  // Обновляем сообщение под актуальный статус в любом случае: если запись
  // уже поменяли в кабинете, кнопки должны это показать.
  const b = await loadBooking(id);
  if (b && q.message) {
    await tg('editMessageText', {
      chat_id: chatId,
      message_id: q.message.message_id,
      text: bookingText(b, b.status === 'cancelled' ? 'Запись отменена' : 'Запись'),
      parse_mode: 'HTML',
      link_preview_options: {is_disabled: true},
      reply_markup: await keyboard(b),
    });
  }
}

async function handleUpdate(u: Update) {
  if (u.message?.text?.startsWith('/start')) {
    await handleStart(u.message.chat.id, u.message.text);
  } else if (u.callback_query) {
    await handleCallback(u.callback_query);
  }
  // Telegram ждёт 200 на любой апдейт, иначе будет повторять.
  return json({ok: true});
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', {status: 405});
  if (!BOT_TOKEN) return json({ok: false, error: 'TELEGRAM_BOT_TOKEN не задан'}, 500);

  try {
    if (safeEqual(req.headers.get('x-notify-secret') ?? '', NOTIFY_SECRET)) {
      return await handleNotify(await req.json());
    }
    if (safeEqual(req.headers.get('x-telegram-bot-api-secret-token') ?? '', WEBHOOK_SECRET)) {
      return await handleUpdate(await req.json());
    }
    return new Response('forbidden', {status: 403});
  } catch (e) {
    console.error(e);
    // Для Telegram отвечаем 200, чтобы он не повторял апдейт бесконечно.
    return json({ok: false, error: String((e as Error).message ?? e)}, 200);
  }
});
