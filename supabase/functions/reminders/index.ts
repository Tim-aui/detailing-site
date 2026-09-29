/**
 * Edge Function: reminders — рассылка напоминаний «завтра у вас запись».
 *
 * Запускается по расписанию (каждые 15 минут), берёт из базы подписки,
 * чьё время пришло (reminders_due), отправляет web push и отмечает
 * отправку (reminder_mark). Подписку создаёт клиент кнопкой «Напомнить
 * за день» после записи (RPC subscribe_reminder).
 *
 * Секреты:
 *   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY — пара ключей web push
 *     (npx web-push generate-vapid-keys; публичный же — VITE_VAPID_PUBLIC_KEY)
 *   VAPID_SUBJECT   — mailto:владелец@почта
 *   CRON_SECRET     — общий секрет с планировщиком
 *
 * Деплой и расписание — см. docs/SETUP.md, раздел «Напоминания».
 */
import webpush from 'npm:web-push@3.6.7';
import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {formatInTimeZone} from 'npm:date-fns-tz@3.2.0';
import {ru} from 'npm:date-fns@4.4.0/locale';

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('Authorization') !== `Bearer ${secret}`) {
    return new Response('forbidden', {status: 403});
  }

  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!,
  );

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: {persistSession: false},
  });

  const {data, error} = await db.rpc('reminders_due', {p_limit: 200});
  if (error) return new Response(error.message, {status: 500});

  let sent = 0;
  let failed = 0;
  for (const r of (data ?? []) as Array<{
    id: string; endpoint: string; p256dh: string; auth: string; tenant_slug: string;
    studio_name: string; timezone: string; address: string | null; code: string; service_name: string; starts_at: string;
  }>) {
    const when = formatInTimeZone(new Date(r.starts_at), r.timezone, "EEEE d MMMM 'в' HH:mm", {locale: ru});
    const payload = JSON.stringify({
      title: `${r.studio_name}: напоминание`,
      body: `${r.service_name} — ${when}.${r.address ? ` ${r.address}.` : ''} Код ${r.code}.`,
      url: `/s/${r.tenant_slug}/my-booking`,
      tag: `booking-${r.code}`,
    });
    try {
      await webpush.sendNotification({endpoint: r.endpoint, keys: {p256dh: r.p256dh, auth: r.auth}}, payload, {TTL: 3600});
      await db.rpc('reminder_mark', {p_id: r.id, p_error: null});
      sent++;
    } catch (e) {
      // 404/410 — подписка умерла; остальное тоже не повторяем бесконечно.
      await db.rpc('reminder_mark', {p_id: r.id, p_error: String((e as Error).message ?? e).slice(0, 300)});
      failed++;
    }
  }
  return new Response(JSON.stringify({sent, failed}), {headers: {'Content-Type': 'application/json'}});
});
