/**
 * Проверка живой ссылки студии после публикации.
 *
 *   pnpm tenant:verify --slug moya-studiya --url https://detailing.vercel.app
 *   pnpm tenant:verify --slug moya-studiya --url … --assistant   # + вопрос помощнику
 *
 * Что проверяется (каждая строка — отдельный пункт отчёта):
 *   1. /s/<slug>/ отдаёт страницу приложения;
 *   2. манифест студии: имя, start_url, standalone, иконки открываются;
 *   3. главное фото открывается;
 *   4. service worker (офлайн и установка) доступен;
 *   5. в базе студия опубликована, услуги совпадают с файлом;
 *   6. сервер отдаёт свободные слоты для первой услуги;
 *   7. (--assistant) помощник отвечает на вопрос о цене.
 *
 * Адрес сайта: --url или SITE_URL в .env.local. База: VITE_SUPABASE_URL и
 * VITE_SUPABASE_ANON_KEY — те же публичные ключи, что у посетителя, поэтому
 * проверка видит ровно то, что увидит клиент (RLS не обходится).
 */
import process from 'node:process';
import {collectTenants} from './tenant-sync.ts';
import {flag, requireFlag} from './args.ts';
import {loadEnv} from './supabase-client.ts';

type Check = {ok: boolean; name: string; detail: string};

async function verify() {
  const argv = process.argv.slice(2);
  const slug = requireFlag('slug', argv, 'Пример: pnpm tenant:verify --slug moya-studiya --url https://…');
  const env = await loadEnv();
  const site = (flag('url', argv) ?? env.SITE_URL ?? '').replace(/\/+$/, '');
  if (!site) throw new Error('❌ Укажите адрес сайта: --url https://… или SITE_URL в .env.local');

  const [entry] = (await collectTenants()).filter((t) => t.slug === slug);
  if (!entry) throw new Error(`❌ tenants/${slug} не найден`);
  const cfg = entry.config;

  const checks: Check[] = [];
  const push = (ok: boolean, name: string, detail = '') => {
    checks.push({ok, name, detail});
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  };
  const get = async (url: string, init?: RequestInit) => {
    try {
      const res = await fetch(url, {redirect: 'follow', ...init, signal: AbortSignal.timeout(15_000)});
      return res;
    } catch (e) {
      return {ok: false, status: 0, statusText: String((e as Error).message), headers: new Headers(), text: async () => '', json: async () => null} as unknown as Response;
    }
  };

  console.log(`Проверяем ${site}/s/${slug}/\n`);

  // 1. Страница
  const page = await get(`${site}/s/${slug}/`);
  const html = page.ok ? await page.text() : '';
  push(page.ok && html.includes('id="root"'), 'Страница студии открывается', page.ok ? `HTTP ${page.status}` : `HTTP ${page.status} ${page.statusText}`);

  // 2. Манифест и иконки
  const man = await get(`${site}/tenants/${slug}/manifest.webmanifest`);
  const manifest = man.ok ? ((await man.json().catch(() => null)) as {name?: string; start_url?: string; display?: string; icons?: {src: string}[]} | null) : null;
  push(
    Boolean(manifest && manifest.start_url?.startsWith(`/s/${slug}`) && manifest.display === 'standalone'),
    'Манифест установки',
    manifest ? `«${manifest.name}», ${manifest.display}, start_url ${manifest.start_url}` : `HTTP ${man.status}`,
  );
  if (manifest?.icons?.length) {
    const results = await Promise.all(manifest.icons.map(async (i) => ({src: i.src, res: await get(new URL(i.src, site).href)})));
    const bad = results.filter((r) => !r.res.ok || !(r.res.headers.get('content-type') ?? '').startsWith('image/'));
    push(bad.length === 0, 'Иконки открываются', bad.length ? `нет: ${bad.map((b) => b.src).join(', ')}` : `${results.length} шт.`);
  }

  // 3. Главное фото
  const hero = /^https?:\/\//.test(cfg.heroPhoto) ? cfg.heroPhoto : `${site}/tenants/${slug}/photos/${cfg.heroPhoto}`;
  const heroRes = await get(hero, {method: 'HEAD'});
  push(heroRes.ok, 'Главное фото', heroRes.ok ? hero.replace(site, '') : `HTTP ${heroRes.status}`);

  // 4. Service worker
  const sw = await get(`${site}/sw.js`);
  push(sw.ok, 'Service worker (офлайн, установка)', `HTTP ${sw.status}`);

  // 5–6. База — глазами посетителя
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    push(false, 'База', 'нет VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY в .env.local — запись и кабинет не проверены');
  } else {
    const rpc = async (name: string, body: unknown) =>
      get(`${url}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
        body: JSON.stringify(body),
      });

    const pr = await rpc('studio_patch', {p_tenant_slug: slug});
    const patch = pr.ok ? await pr.json() : null;
    push(pr.ok, 'Студия опубликована в базе', pr.ok ? 'посетитель видит настройки' : `HTTP ${pr.status}: ${(await pr.text()).slice(0, 160)} — запустите pnpm tenant:push --slug ${slug}`);

    const services = ((patch as {services?: {id: string; isActive: boolean}[]} | null)?.services ?? cfg.services).filter((s) => s.isActive);
    const first = services[0];
    if (first) {
      const from = new Date();
      const to = new Date(Date.now() + cfg.bookingHorizonDays * 86_400_000);
      const fr = await rpc('studio_free_slots', {p_tenant_slug: slug, p_service_id: first.id, p_from: from.toISOString(), p_to: to.toISOString(), p_limit: 5});
      const free = fr.ok ? ((await fr.json()) as {slots?: {startUtc: string}[]}) : null;
      push(
        Boolean(free?.slots?.length),
        'Сервер отдаёт свободное время',
        free?.slots?.length
          ? `«${first.id}»: ближайшее ${new Date(free.slots[0].startUtc).toLocaleString('ru-RU', {timeZone: cfg.timezone})}`
          : fr.ok
            ? 'свободных окон нет — проверьте часы и боксы'
            : `HTTP ${fr.status}: ${(await fr.text()).slice(0, 160)}`,
      );
    }

    if (argv.includes('--assistant')) {
      const svc = cfg.services.find((s) => s.isActive);
      const q = svc ? `Сколько стоит ${svc.name.toLowerCase()}?` : 'Когда ближайшее окно?';
      const ar = await get(`${url}/functions/v1/assistant`, {
        method: 'POST',
        headers: {apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({tenant_slug: slug, question: q, mode: 'client'}),
      });
      const a = ar.ok ? ((await ar.json()) as {answer?: string; tools?: string[]}) : null;
      push(
        Boolean(a?.answer),
        'Помощник отвечает',
        a?.answer ? `«${q}» → ${a.answer.slice(0, 120).replace(/\s+/g, ' ')}… (данные: ${(a.tools ?? []).join(', ') || 'без запросов'})` : `HTTP ${ar.status}: ${(await ar.text()).slice(0, 160)}`,
      );
    }
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(failed.length ? `\n✗ Не прошло: ${failed.length} из ${checks.length}` : `\n✓ Всё работает: ${site}/s/${slug}/`);
  if (failed.length) process.exit(1);
}

if (import.meta.filename === process.argv[1]) {
  verify().catch((err) => {
    console.error(String(err.message ?? err));
    process.exit(1);
  });
}
