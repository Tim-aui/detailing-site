/**
 * Vite-плагин: отдельный HTML на каждую студию (FIXES.md, 3.1).
 *
 * Сайт — SPA, и без этого /s/<slug>/ у всех студий отдавал один и тот же
 * <title>Запись в студию</title> без og:*. Мессенджеры и поисковики JS не
 * выполняют, поэтому ссылка в WhatsApp/Telegram приходила «голой».
 *
 * После сборки берём dist/index.html и для каждой студии из
 * src/tenants/generated/seo.json (его пишет `tenant:sync`) кладём копию
 * с её метаданными в dist/s/<slug>/index.html и в подпапки основных
 * страниц (booking, services, …). Vercel сначала ищет файл и только потом
 * применяет rewrite на /index.html, так что:
 *   • известные студии и страницы получают свой HTML;
 *   • всё остальное (кабинет, неизвестный адрес) — как раньше, общий index.html.
 * Приложение внутри то же самое: тот же бандл, тот же роутер.
 */
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {Plugin} from 'vite';

type SeoTenant = {
  slug: string;
  isSample: boolean;
  previousSlugs: string[];
  name: string;
  description: string;
  image: string;
  themeColor: string;
};

const PAGES: Array<{path: string; title: (name: string) => string}> = [
  {path: '', title: (n) => `${n} — онлайн-запись`},
  {path: 'booking', title: (n) => `Запись — ${n}`},
  {path: 'services', title: (n) => `Услуги и цены — ${n}`},
  {path: 'my-booking', title: (n) => `Мои записи — ${n}`},
  {path: 'privacy', title: (n) => `Политика конфиденциальности — ${n}`},
  {path: 'assistant', title: (n) => `Помощник — ${n}`},
];

function attr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderTenantHtml(html: string, site: string, t: SeoTenant, page: (typeof PAGES)[number], urlSlug = t.slug) {
  const title = page.title(t.name);
  const canonical = `${site}/s/${t.slug}/${page.path}`;
  const tags = [
    `<meta name="description" content="${attr(t.description)}" />`,
    `<link rel="canonical" href="${attr(canonical)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:locale" content="ru_RU" />`,
    `<meta property="og:site_name" content="${attr(t.name)}" />`,
    `<meta property="og:title" content="${attr(title)}" />`,
    `<meta property="og:description" content="${attr(t.description)}" />`,
    `<meta property="og:url" content="${attr(canonical)}" />`,
    `<meta property="og:image" content="${attr(t.image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    // Образец и прежний адрес не индексируем: у первого нет настоящих
    // данных, второй дублирует новый адрес.
    ...(t.isSample || urlSlug !== t.slug ? ['<meta name="robots" content="noindex" />'] : []),
  ].join('\n    ');

  let out = html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${attr(title)}</title>`)
    .replace(/<meta name="description"[^>]*>/, tags)
    .replace(/<meta name="theme-color" content="[^"]*"/, `<meta name="theme-color" content="${attr(t.themeColor)}"`)
    .replace(/<link rel="manifest"[^>]*>/, `<link rel="manifest" href="/tenants/${t.slug}/manifest.webmanifest" />`)
    .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="/tenants/${t.slug}/icon-192.png" type="image/png" />`)
    .replace(/<link rel="apple-touch-icon"[^>]*>/, `<link rel="apple-touch-icon" href="/tenants/${t.slug}/apple-touch-icon.png" />`);
  if (!out.includes('og:title')) {
    // В шаблоне нет meta description — вставляем перед </head>.
    out = out.replace('</head>', `    ${tags}\n  </head>`);
  }
  return out;
}

export function tenantSeoPages(seoFile = 'src/tenants/generated/seo.json'): Plugin {
  let outDir = 'dist';
  return {
    name: 'tenant-seo-pages',
    apply: 'build',
    configResolved(cfg) {
      outDir = path.resolve(cfg.root, cfg.build.outDir);
    },
    async writeBundle() {
      const raw = await readFile(seoFile, 'utf8').catch(() => '');
      if (!raw) {
        this.warn(`${seoFile} не найден — запустите pnpm tenant:sync; страницы студий не созданы`);
        return;
      }
      const {site, tenants} = JSON.parse(raw) as {site: string; tenants: SeoTenant[]};
      const html = await readFile(path.join(outDir, 'index.html'), 'utf8');
      let count = 0;
      for (const t of tenants) {
        for (const urlSlug of [t.slug, ...(t.previousSlugs ?? [])]) {
          for (const page of PAGES) {
            const dir = path.join(outDir, 's', urlSlug, page.path);
            await mkdir(dir, {recursive: true});
            await writeFile(path.join(dir, 'index.html'), renderTenantHtml(html, site, t, page, urlSlug));
            count++;
          }
        }
      }
      console.log(`tenant-seo-pages: ${count} страниц для ${tenants.length} студий`);
    },
  };
}
