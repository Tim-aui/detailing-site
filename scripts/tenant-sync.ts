/**
 * Генератор артефактов студий.
 *
 *   pnpm tenant:sync
 *
 * Читает `tenants/<slug>/studio.json`, проверяет схемой и собирает:
 *   src/tenants/generated/registry.ts   — данные для приложения
 *   public/tenants/<slug>/manifest…     — манифест PWA каждой студии
 *   public/tenants/<slug>/photos/…      — фото
 *   public/tenants/<slug>/icon-*.png    — иконки установки
 *
 * Запускается автоматически перед dev/build.
 */
import {readFile, readdir, writeFile, mkdir, cp, access} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {studioSettingsSchema, type StudioSettings} from '../src/tenants/schema.ts';
import {toSlotKey, loadBranding} from './branding.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tenantsDir = path.join(root, 'tenants');
const generatedDir = path.join(root, 'src/tenants/generated');
const publicTenantsDir = path.join(root, 'public/tenants');

export type TenantEntry = {
  slug: string;
  name: string;
  config: StudioSettings;
  /** Заполняется при публикации: пока студия доступна только как образец. */
  isSample: boolean;
};

async function exists(p: string) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function collectTenants(): Promise<TenantEntry[]> {
  const dirs = (await readdir(tenantsDir, {withFileTypes: true}))
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const out: TenantEntry[] = [];
  for (const dir of dirs) {
    const file = path.join(tenantsDir, dir, 'studio.json');
    if (!(await exists(file))) {
      console.warn(`⚠️  tenants/${dir} — нет studio.json, пропускаю`);
      continue;
    }
    const raw = JSON.parse(await readFile(file, 'utf8'));
    const parsed = studioSettingsSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `❌ tenants/${dir}/studio.json не проходит проверку:\n` +
          parsed.error.issues
            .map((i) => `   • ${i.path.join('.') || '(корень)'}: ${i.message}`)
            .join('\n'),
      );
    }
    if (parsed.data.slug !== dir) {
      throw new Error(
        `❌ tenants/${dir}/studio.json: slug="${parsed.data.slug}" не совпадает с именем папки "${dir}". ` +
          `Папка определяет адрес /s/${dir}/.`,
      );
    }
    const samplePath = path.join(tenantsDir, dir, 'sample.json');
    out.push({
      slug: parsed.data.slug,
      name: parsed.data.name,
      config: parsed.data,
      isSample: await exists(samplePath),
    });
  }
  if (out.length === 0) throw new Error('❌ Не найдено ни одной студии в tenants/');
  return out;
}

async function writeIcons(tenant: TenantEntry, outDir: string) {
  const branding = await loadBranding(tenant, path.join(tenantsDir, tenant.slug));
  const sizes = [192, 512, 180, 512];
  const names = ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'icon-maskable-512.png'];

  for (let i = 0; i < names.length; i++) {
    const size = sizes[i];
    const maskable = names[i].includes('maskable');
    // Маскируемая иконка требует безопасной зоны: подложка во весь квадрат,
    // логотип занимает центральные 60%.
    const inner = maskable ? Math.round(size * 0.6) : Math.round(size * 0.72);
    const logo = await sharp(branding.logoPath)
      .resize(inner, inner, {fit: 'inside'})
      .png()
      .toBuffer();
    const pad = Math.round((size - inner) / 2);
    const canvas = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
        `<rect width="${size}" height="${size}" rx="${maskable ? 0 : Math.round(size * 0.22)}" fill="${branding.background}"/>` +
        `</svg>`,
    );
    await sharp(canvas)
      .composite([{input: logo, gravity: 'center', top: pad, left: pad}])
      .png()
      .toFile(path.join(outDir, names[i]));
  }
  return names;
}

export async function syncTenants() {
  const tenants = await collectTenants();
  await rmrf(generatedDir);
  await mkdir(generatedDir, {recursive: true});

  const publicEntries: Array<{slug: string; name: string; isSample: boolean}> = [];

  for (const tenant of tenants) {
    const outDir = path.join(publicTenantsDir, tenant.slug);
    await rmrf(outDir);
    await mkdir(outDir, {recursive: true});

    // Фото
    const srcPhotos = path.join(tenantsDir, tenant.slug, 'photos');
    if (await exists(srcPhotos)) {
      await cp(srcPhotos, path.join(outDir, 'photos'), {recursive: true});
    }

    // Иконки установки
    await writeIcons(tenant, outDir);

    // Манифест PWA: отдельный на каждый студию, чтобы «На экран Домой»
    // ставил приложение с правильным именем и иконкой.
    const branding = await loadBranding(tenant, tenantsDir + '/' + tenant.slug);
    const short = tenant.config.pwa.shortName || tenant.config.name;
    const manifest = {
      id: `/s/${tenant.slug}/`,
      name: `${tenant.config.name} — запись`,
      short_name: short.slice(0, 24),
      description: tenant.config.description,
      start_url: `/s/${tenant.slug}/`,
      scope: `/s/${tenant.slug}/`,
      display: 'standalone',
      orientation: 'portrait',
      background_color: tenant.config.pwa.backgroundColor,
      theme_color: tenant.config.pwa.themeColor,
      lang: 'ru',
      dir: 'ltr',
      categories: ['business', 'lifestyle'],
      icons: [
        {src: `/tenants/${tenant.slug}/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any'},
        {src: `/tenants/${tenant.slug}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any'},
        {src: `/tenants/${tenant.slug}/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable'},
      ],
      shortcuts: [
        {name: 'Записаться', short_name: 'Запись', url: `/s/${tenant.slug}/booking`, icons: [{src: `/tenants/${tenant.slug}/icon-192.png`, sizes: '192x192'}]},
        {name: 'Моя запись', short_name: 'Моя запись', url: `/s/${tenant.slug}/my-booking`, icons: [{src: `/tenants/${tenant.slug}/icon-192.png`, sizes: '192x192'}]},
      ],
      ...(tenant.isSample ? {x_sample: true, branding: branding.tint} : {}),
    };
    await writeFile(path.join(outDir, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));

    publicEntries.push({slug: tenant.slug, name: tenant.name, isSample: tenant.isSample});
    console.log(`✓ ${tenant.slug} — ${tenant.name}${tenant.isSample ? ' (образец)' : ''}`);
  }

  // Реестр для приложения. Настройки лежат в JSON-строке: так они
  // попадают в бандл без дерева зависимостей и остаются валидируемыми.
  // Студия для короткой ссылки «/» — tenants/root-slug.txt (одно слово,
  // например demo). Без файла — первая опубликованная по алфавиту.
  const rootSlug = (await readFile(path.join(tenantsDir, 'root-slug.txt'), 'utf8').catch(() => '')).trim();
  if (rootSlug && !publicEntries.some((e) => e.slug === rootSlug && !e.isSample)) {
    console.warn(`⚠ tenants/root-slug.txt: «${rootSlug}» нет среди опубликованных студий — «/» поведёт на первую по алфавиту`);
  }
  const payload = publicEntries
    .map((e) => ({...e, config: tenants.find((t) => t.slug === e.slug)!.config}))
    // Черновики в конец: реестр[0] — это адрес для короткой ссылки,
    // он не должен указывать на неопубликованную студию.
    .sort(
      (a, b) =>
        Number(a.isSample) - Number(b.isSample) ||
        Number(b.slug === rootSlug) - Number(a.slug === rootSlug) ||
        a.slug.localeCompare(b.slug),
    );
  if (payload[0]) console.log(`  Короткая ссылка «/» → /s/${payload[0].slug}/`);

  const ts = `// АВТОГЕНЕРИРУЕТСЯ файлом scripts/tenant-sync.ts. Не редактировать вручную.
// Источник правды: tenants/<slug>/studio.json
import {studioSettingsSchema, type StudioSettings} from '../schema.ts';

const RAW = ${JSON.stringify(payload)} as const;

export type TenantSeed = {
  slug: string;
  name: string;
  isSample: boolean;
  config: StudioSettings;
};

export const TENANT_SEEDS: TenantSeed[] = RAW.map((t) => ({
  slug: t.slug,
  name: t.name,
  isSample: t.isSample,
  config: studioSettingsSchema.parse(t.config),
}));

export const DEFAULT_TENANT_SLUG = TENANT_SEEDS[0].slug;
`;
  await writeFile(path.join(generatedDir, 'registry.ts'), ts);

  // Шпаргалка: какие слоты что занимают — используется в тестах расписания.
  const slotMap = Object.fromEntries(tenants.map((t) => [t.slug, toSlotKey(t.config)]));
  await writeFile(path.join(generatedDir, 'slotmap.json'), JSON.stringify(slotMap, null, 2));

  console.log(`\nГотово: ${tenants.length} студия(ий), реестр → src/tenants/generated/registry.ts`);
  return tenants;
}

async function rmrf(p: string) {
  const {rm} = await import('node:fs/promises');
  await rm(p, {recursive: true, force: true});
}

if (import.meta.filename === process.argv[1]) {
  syncTenants().catch((err) => {
    console.error(String(err.message ?? err));
    process.exit(1);
  });
}
