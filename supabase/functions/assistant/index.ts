/**
 * Edge Function: assistant
 *
 * Принимает вопрос клиента, собирает контекст из базы (услуги, цены,
 * ближайшие окна), спрашивает модель и возвращает ответ.
 *
 * Запуск:
 *   pnpm supabase functions deploy assistant --no-verify-jwt
 *
 * Переменные окружения (в Supabase Dashboard → Edge Functions → Settings):
 *   OPENAI_API_KEY — секрет, не попадает в клиент.
 *
 * Без OPENAI_API_KEY возвращает заглушку.
 */
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {serve} from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Context = {
  studio: {name: string; phone: string; address: string; tagline: string; timezone: string; hours: any[]};
  services: {id: string; name: string; price: number; durationMin: number; days: number}[];
  freeSlots: {service: string; slot: string}[];
  cancellation: {freeCancelHours: number; note: string};
  generatedAt: string;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: corsHeaders});

  try {
    const {tenant_slug, question, actor} = await req.json();
    if (!tenant_slug || !question) {
      return json({error: 'Нужен tenant_slug и question'}, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 1. Контекст для модели
    const {data: ctx, error: ctxErr} = await supabase.rpc('assistant_context', {p_tenant_slug: tenant_slug});
    if (ctxErr) return json({error: ctxErr.message}, 500);
    if (!ctx || ctx.error) return json({error: ctx.error || 'Студия не найдена'}, 404);

    // 2. Проверка лимита
    const {data: ok, error: limErr} = await supabase.rpc('assistant_log', {
      p_tenant_slug: tenant_slug,
      p_actor: actor || 'anon',
      p_question: question,
      p_limit: 20,
    });
    if (limErr) return json({error: limErr.message}, 500);
    if (!ok) return json({error: 'Превышен лимит вопросов. Попробуйте через час.'}, 429);

    // 3. Промпт
    const services = (ctx.services as Context['services'])
      .map((s) => `• ${s.name} — ${(s.price / 100).toFixed(0)} ₽, ${s.durationMin} мин${s.days > 1 ? `, ${s.days} дня` : ''}`)
      .join('\n');

    const slots = (ctx.freeSlots as Context['freeSlots'])
      .slice(0, 10)
      .map((f) => `  ${f.slot} — ${f.service}`)
      .join('\n');

    const system = `Ты — помощник детейлинг-студии «${ctx.studio.name}».
Отвечай кратко, по делу, на русском. Не выдумывай цены и время — используй только данные ниже.

Студия: ${ctx.studio.name} (${ctx.studio.tagline})
Телефон: ${ctx.studio.phone}
Адрес: ${ctx.studio.address}
Часовой пояс: ${ctx.studio.timezone}

Услуги:
${services}

Ближайшие свободные окна (примерно):
${slots || '  (нет свободных окон в ближайшие дни)'}

Политика отмены: ${ctx.cancellation.note}

Текущее время: ${new Date(ctx.generatedAt).toLocaleString('ru-RU', {timeZone: ctx.studio.timezone})}`;

    // 4. Запрос к модели
    let answer: string;
    const openaiKey = Deno.env.get('OPENAI_API_KEY');

    if (!openaiKey) {
      // Заглушка без ключа — для разработки
      answer = `Извините, помощник пока не настроен (нет ключа OpenAI). Вы можете позвонить нам: ${ctx.studio.phone}`;
    } else {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {role: 'system', content: system},
            {role: 'user', content: question},
          ],
          temperature: 0.3,
          max_tokens: 300,
        }),
      });

      if (!resp.ok) {
        const txt = await resp.text();
        console.error('OpenAI error', resp.status, txt);
        answer = 'Произошла ошибка модели. Попробуйте переформулировать вопрос или позвоните в студию.';
      } else {
        const data = await resp.json();
        answer = data.choices[0]?.message?.content?.trim() || 'Пустой ответ модели.';
      }
    }

    // 5. Сохраняем ответ в историю
    await supabase.rpc('assistant_log', {
      p_tenant_slug: tenant_slug,
      p_actor: actor || 'anon',
      p_question: question,
      p_answer: answer,
    });

    return json({answer});
  } catch (e) {
    console.error('Assistant error:', e);
    return json({error: 'Внутренняя ошибка'}, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {...corsHeaders, 'Content-Type': 'application/json'},
  });
}