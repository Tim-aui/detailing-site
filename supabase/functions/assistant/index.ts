/**
 * Edge Function: assistant — помощник студии (клиент и владелец).
 *
 * Как отвечает: модель НЕ получает готовых данных в промпте и не может их
 * выдумать — она вызывает инструменты (tool calling), а инструменты ходят
 * в базу через SQL-функции. Цены, окна, записи и деньги берутся только
 * оттуда. Если данных нет — помощник так и говорит.
 *
 *   клиент   list_services, find_free_slots, studio_info — только публичное;
 *            список клиентов и чужие записи ему недоступны в принципе.
 *   владелец get_bookings, get_stats, get_payments + то же, что клиент.
 *            Вызовы идут с токеном владельца: права проверяет база
 *            (owner_* функции), а инструментов изменения данных нет.
 *
 * Лимиты (assistant_quota в базе):
 *   ASSISTANT_ACTOR_LIMIT   вопросов в час на человека (20 клиент / 60 владелец)
 *   ASSISTANT_TENANT_DAILY  вопросов в сутки на студию (300)
 *   ASSISTANT_DAILY_TOKENS  токенов модели в сутки на весь проект (400 000) —
 *                           это потолок расходов на модель
 *   ASSISTANT_MAX_TOKENS    токенов на один ответ (400)
 *
 * Модель задаётся на сервере: OPENAI_MODEL (по умолчанию gpt-4.1-mini).
 * Ключи: OPENAI_API_KEY; SUPABASE_URL / SUPABASE_ANON_KEY /
 * SUPABASE_SERVICE_ROLE_KEY Supabase подставляет сам.
 *
 * Деплой:  pnpm supabase functions deploy assistant --no-verify-jwt
 *          pnpm supabase secrets set OPENAI_API_KEY=sk-... OPENAI_MODEL=gpt-4.1-mini
 */
import OpenAI from 'npm:openai@7.23.0';
import {createClient, type SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2';
import {formatInTimeZone, fromZonedTime} from 'npm:date-fns-tz@3.2.0';
import {ru} from 'npm:date-fns@4.4.0/locale';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const env = (k: string, d = '') => Deno.env.get(k) ?? d;
const num = (k: string, d: number) => {
  const v = Number(Deno.env.get(k));
  return Number.isFinite(v) && v > 0 ? v : d;
};

type Mode = 'client' | 'owner';
type Msg = {role: 'user' | 'assistant'; text: string};
type Cfg = {
  name: string;
  timezone: string;
  phone: string;
  address?: {full?: string; directionsNote?: string; latitude?: number | null; longitude?: number | null};
  hours: {day: number; open: string | null; close: string | null}[];
  closedDates?: string[];
  services: {id: string; name: string; description?: string; price: number; durationMin: number; days?: number; isActive?: boolean}[];
  cancellation?: {freeCancelHours?: number; note?: string};
  bookingHorizonDays?: number;
  assistantEnabled?: boolean;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: cors});
  if (req.method !== 'POST') return json({error: 'Только POST'}, 405);

  let body: {tenant_slug?: string; question?: string; mode?: Mode; history?: Msg[]};
  try {
    body = await req.json();
  } catch {
    return json({error: 'Некорректный запрос'}, 400);
  }

  const slug = String(body.tenant_slug ?? '').trim();
  const question = String(body.question ?? '').trim().slice(0, 500);
  const mode: Mode = body.mode === 'owner' ? 'owner' : 'client';
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
    .slice(-8)
    .map((m) => ({role: m.role, content: m.text.slice(0, 1000)}));

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || question.length < 2) {
    return json({error: 'Нужны студия и вопрос'}, 400);
  }

  const url = env('SUPABASE_URL');
  const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), {auth: {persistSession: false}});

  // Настройки студии с правками владельца. Клиенту — только опубликованные.
  const {data: cfg} = await admin.rpc(mode === 'owner' ? 'studio_config_any' : 'studio_config', {p_slug: slug});
  if (!cfg) return json({error: 'Студия не найдена'}, 404);
  return handle(cfg as Cfg);

  async function handle(config: Cfg): Promise<Response> {
    // --- кто спрашивает ----------------------------------------------------
    let actor: string;
    let ownerClient: SupabaseClient | null = null;
    if (mode === 'owner') {
      const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      const {data: userData} = await admin.auth.getUser(token);
      if (!userData?.user) return json({error: 'Войдите в кабинет заново'}, 401);
      ownerClient = createClient(url, env('SUPABASE_ANON_KEY'), {
        auth: {persistSession: false},
        global: {headers: {Authorization: `Bearer ${token}`}},
      });
      const {data: allowed} = await ownerClient.rpc('can_manage_tenant', {p_slug: slug});
      if (allowed !== true) return json({error: 'Нет доступа к этой студии'}, 403);
      actor = `owner:${userData.user.id}`;
    } else {
      // Помощник для клиентов включается в studio.json. Выключен — не тратим
      // модель, даже если кто-то вызовет функцию напрямую.
      if (config.assistantEnabled !== true) return json({error: 'Помощник отключён в этой студии'}, 403);
      // Клиента узнаём по IP (хешем: сам адрес не храним). Телефон из
      // запроса подделать проще, поэтому лимит по нему не считаем.
      const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
      actor = `ip:${await sha256(`${ip}|${slug}|${env('ASSISTANT_SALT', 'studio')}`)}`;
    }

    // --- лимиты ------------------------------------------------------------
    const {data: quota, error: qErr} = await admin.rpc('assistant_quota', {
      p_tenant_slug: slug,
      p_actor: actor,
      p_actor_limit: mode === 'owner' ? num('ASSISTANT_OWNER_LIMIT', 60) : num('ASSISTANT_ACTOR_LIMIT', 20),
      p_tenant_daily: num('ASSISTANT_TENANT_DAILY', 300),
      p_daily_tokens: num('ASSISTANT_DAILY_TOKENS', 400_000),
    });
    if (qErr) return json({error: 'Помощник временно недоступен'}, 500);
    if (!quota?.ok) return json({error: quota?.reason ?? 'Лимит вопросов исчерпан'}, 429);

    const tz = config.timezone || 'Europe/Moscow';
    const tools = new Tools(admin, ownerClient, slug, config, tz);

    const apiKey = env('OPENAI_API_KEY');
    let answer: string;
    let tokens = 0;
    if (!apiKey) {
      answer = `Помощник ещё не подключён. Позвоните в студию: ${config.phone}.`;
    } else {
      try {
        const r = await runModel(apiKey, config, tz, mode, history, question, tools);
        answer = r.answer;
        tokens = r.tokens;
      } catch (e) {
        console.error('model error', e);
        answer = `Не получилось ответить. Позвоните в студию: ${config.phone}.`;
      }
    }

    await admin.rpc('assistant_record', {
      p_tenant_slug: slug,
      p_actor: actor,
      p_mode: mode,
      p_question: question,
      p_answer: answer,
      p_tokens: tokens,
    });

    return json({answer, tools: tools.used});
  }
});

// ---------------------------------------------------------------------------
// Модель
// ---------------------------------------------------------------------------

async function runModel(
  apiKey: string,
  cfg: Cfg,
  tz: string,
  mode: Mode,
  history: {role: 'user' | 'assistant'; content: string}[],
  question: string,
  tools: Tools,
): Promise<{answer: string; tokens: number}> {
  const openai = new OpenAI({apiKey, baseURL: env('OPENAI_BASE_URL') || undefined});
  const model = env('OPENAI_MODEL', 'gpt-4.1-mini');
  const now = new Date();
  const today = formatInTimeZone(now, tz, "EEEE, d MMMM yyyy, HH:mm", {locale: ru});

  const system =
    mode === 'owner'
      ? `Ты — помощник владельца автостудии «${cfg.name}» в его кабинете. Сейчас ${today} (часовой пояс ${tz}).
Отвечай по-русски, коротко и по делу, цифрами.
Любые данные о записях, машинах и деньгах бери ТОЛЬКО из инструментов get_bookings, get_stats, get_payments. Ничего не придумывай и не округляй «на глаз».
«Завтра», «на неделе», «в этом месяце» переводи в даты сам (неделя — с понедельника по воскресенье, если не сказано иное).
Ты только читаешь данные. Изменить, перенести, отменить запись или внести оплату ты не можешь — предложи сделать это в разделе «Записи».`
      : `Ты — помощник автостудии «${cfg.name}» на её сайте. Сейчас ${today} (часовой пояс студии ${tz}).
Отвечай по-русски, коротко (2–5 предложений), дружелюбно.
Цены, длительность, адрес, часы и свободное время бери ТОЛЬКО из инструментов. Никогда не придумывай окна, цены и записи.
Если непонятно, о какой услуге речь, — задай уточняющий вопрос и перечисли 2–4 подходящие услуги.
Когда называешь свободное время, добавь, что записаться можно кнопкой «Записаться».
Ты не знаешь и не раскрываешь ничего о других клиентах и их записях. На вопросы не о студии вежливо возвращай к услугам.`;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {role: 'system', content: system},
    ...history,
    {role: 'user', content: question},
  ];

  let tokens = 0;
  for (let round = 0; round < 5; round++) {
    const res = await openai.chat.completions.create({
      model,
      messages,
      tools: tools.schema(mode),
      tool_choice: 'auto',
      temperature: 0.2,
      max_completion_tokens: num('ASSISTANT_MAX_TOKENS', 400),
    });
    tokens += res.usage?.total_tokens ?? 0;
    const msg = res.choices[0]?.message;
    if (!msg) break;
    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) {
      return {answer: (msg.content ?? '').trim() || 'Не нашёл ответа — позвоните в студию.', tokens};
    }
    messages.push(msg);
    for (const call of calls) {
      if (call.type !== 'function') continue;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        /* пустые аргументы */
      }
      const result = await tools.run(call.function.name, args, mode);
      messages.push({role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 12_000)});
    }
  }
  return {answer: `Не получилось ответить. Позвоните в студию: ${cfg.phone}.`, tokens};
}

// ---------------------------------------------------------------------------
// Инструменты: единственный путь к данным
// ---------------------------------------------------------------------------

class Tools {
  used: string[] = [];
  constructor(
    private admin: SupabaseClient,
    private owner: SupabaseClient | null,
    private slug: string,
    private cfg: Cfg,
    private tz: string,
  ) {}

  schema(mode: Mode): OpenAI.Chat.Completions.ChatCompletionTool[] {
    const period = {
      type: 'object',
      properties: {
        date_from: {type: 'string', description: 'Первый день периода, YYYY-MM-DD (время студии)'},
        date_to: {type: 'string', description: 'Последний день периода включительно, YYYY-MM-DD'},
      },
      required: ['date_from', 'date_to'],
      additionalProperties: false,
    };
    const common: OpenAI.Chat.Completions.ChatCompletionTool[] = [
      fn('list_services', 'Услуги студии: id, название, цена в рублях, длительность.', {type: 'object', properties: {}}),
      fn('studio_info', 'Адрес, как добраться, телефон, часы работы, нерабочие даты, правила отмены.', {type: 'object', properties: {}}),
      fn('find_free_slots', 'Ближайшее свободное время для услуги. Учитывает расписание, занятость боксов, длительность и буфер.', {
        type: 'object',
        properties: {
          service_id: {type: 'string', description: 'id услуги из list_services'},
          date_from: {type: 'string', description: 'С какого дня искать, YYYY-MM-DD. По умолчанию — сегодня'},
          date_to: {type: 'string', description: 'По какой день включительно, YYYY-MM-DD'},
          limit: {type: 'integer', minimum: 1, maximum: 10},
        },
        required: ['service_id'],
        additionalProperties: false,
      }),
    ];
    if (mode !== 'owner') return common;
    return [
      ...common,
      fn('get_bookings', 'Записи студии за период: время, услуга, статус, клиент, машина, цена, оплачено.', period),
      fn('get_stats', 'Сводка за период: заезды, выполнено, отменено, ожидаемая выручка, реально получено денег, возвраты.', period),
      fn('get_payments', 'Оплаты и возвраты за период.', period),
    ];
  }

  async run(name: string, args: Record<string, unknown>, mode: Mode): Promise<unknown> {
    this.used.push(name);
    try {
      switch (name) {
        case 'list_services':
          return this.services();
        case 'studio_info':
          return this.info();
        case 'find_free_slots':
          return await this.slots(args);
        case 'get_bookings':
        case 'get_stats':
        case 'get_payments':
          if (mode !== 'owner' || !this.owner) return {error: 'Недоступно'};
          return await this.ownerData(name, args);
        default:
          return {error: `Нет инструмента ${name}`};
      }
    } catch (e) {
      return {error: e instanceof Error ? e.message : String(e)};
    }
  }

  private services() {
    return this.cfg.services
      .filter((s) => s.isActive !== false)
      .map((s) => ({
        id: s.id,
        name: s.name,
        price: rub(s.price),
        duration: (s.days ?? 1) > 1 ? `${s.days} дн.` : `${Math.round((s.durationMin / 60) * 10) / 10} ч`,
        about: s.description ?? '',
      }));
  }

  private info() {
    const days = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
    const a = this.cfg.address ?? {};
    return {
      name: this.cfg.name,
      phone: this.cfg.phone,
      address: a.full ?? '',
      directions: a.directionsNote ?? '',
      map:
        a.latitude != null && a.longitude != null
          ? `https://yandex.ru/maps/?pt=${a.longitude},${a.latitude}&z=16&l=map`
          : `https://yandex.ru/maps/?text=${encodeURIComponent(a.full ?? '')}`,
      hours: [1, 2, 3, 4, 5, 6, 0].map((d) => {
        const h = this.cfg.hours.find((x) => x.day === d);
        return `${days[d]}: ${h?.open ? `${h.open}–${h.close}` : 'выходной'}`;
      }),
      closedDates: this.cfg.closedDates ?? [],
      cancellation: this.cfg.cancellation ?? {},
    };
  }

  private async slots(args: Record<string, unknown>) {
    const id = String(args.service_id ?? '');
    const service = this.cfg.services.find((s) => s.id === id && s.isActive !== false);
    if (!service) {
      return {error: 'Такой услуги нет', services: this.services().map((s) => ({id: s.id, name: s.name}))};
    }
    const from = this.dayStart(args.date_from) ?? new Date();
    const to = this.dayStart(args.date_to, 1) ?? new Date(from.getTime() + 14 * 86_400_000);
    const limit = Math.min(Math.max(Number(args.limit) || 6, 1), 10);
    const {data, error} = await this.admin.rpc('next_free_slots', {
      p_tenant_slug: this.slug,
      p_service_id: id,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      p_limit: limit,
    });
    if (error) return {error: error.message};
    const rows = (data ?? []) as {start_at: string; end_at: string}[];
    return {
      service: service.name,
      price: rub(service.price),
      slots: rows.map((r) => formatInTimeZone(new Date(r.start_at), this.tz, 'EEEE d MMMM, HH:mm', {locale: ru})),
      note: rows.length === 0 ? 'В этом периоде свободного времени нет' : undefined,
    };
  }

  private async ownerData(name: string, args: Record<string, unknown>) {
    const from = this.dayStart(args.date_from);
    const to = this.dayStart(args.date_to, 1);
    if (!from || !to) return {error: 'Нужны даты YYYY-MM-DD'};
    const params = {p_tenant_slug: this.slug, p_from: from.toISOString(), p_to: to.toISOString()};
    const fnName = name === 'get_bookings' ? 'owner_bookings' : name === 'get_stats' ? 'owner_stats' : 'owner_payments';
    const {data, error} = await this.owner!.rpc(fnName, params);
    if (error) return {error: error.message};
    const t = (iso: string) => formatInTimeZone(new Date(iso), this.tz, 'EEEEEE d MMM HH:mm', {locale: ru});
    if (name === 'get_stats') {
      const s = data as Record<string, number>;
      return {
        visits: s.visits,
        done: s.done,
        pending: s.pending,
        cancelled: s.cancelled,
        expected: rub(s.expected),
        received: rub(s.received),
        refunds: rub(s.refunds),
      };
    }
    if (name === 'get_bookings') {
      const status: Record<string, string> = {
        pending: 'ждёт подтверждения',
        confirmed: 'подтверждена',
        in_progress: 'в работе',
        done: 'готово',
        cancelled: 'отменена',
      };
      return (data as Record<string, unknown>[]).map((b) => ({
        when: `${t(b.starts_at as string)} → ${t(b.ends_at as string)}`,
        service: b.service_name,
        status: status[b.status as string] ?? b.status,
        client: b.contact_name,
        phone: b.contact_phone,
        car: b.car,
        price: rub(b.price as number),
        paid: rub(b.paid as number),
        code: b.code,
      }));
    }
    return (data as Record<string, unknown>[]).map((p) => ({
      when: t(p.created_at as string),
      kind: p.kind === 'refund' ? 'возврат' : 'оплата',
      amount: rub(p.amount as number),
      booking: p.booking_code,
      client: p.contact_name,
    }));
  }

  /** YYYY-MM-DD в поясе студии → момент начала дня (+offsetDays). */
  private dayStart(v: unknown, offsetDays = 0): Date | null {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const d = fromZonedTime(`${v} 00:00`, this.tz);
    return new Date(d.getTime() + offsetDays * 86_400_000);
  }
}

function fn(name: string, description: string, parameters: Record<string, unknown>): OpenAI.Chat.Completions.ChatCompletionTool {
  return {type: 'function', function: {name, description, parameters}};
}

/** Копейки → «13 000 ₽». */
function rub(kopecks: number): string {
  return `${new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 0}).format(Math.round((kopecks ?? 0) / 100))} ₽`;
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {status, headers: {...cors, 'Content-Type': 'application/json'}});
}
