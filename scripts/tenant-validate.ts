/**
 * Проверка студии перед публикацией.
 *
 *   pnpm tenant:validate --slug novaya-studiya
 *
 * Схема Zod уже проверяется при сборке, но здесь мы ловим вещи,
 * которые формально валидны, а в жизни сломаются: пустое фото,
 * нулевая цена, боксов меньше, чем длительных услуг, часы без
 * единого рабочего дня. Именно на них обычно «зависает» студия
 * после первой публикации.
 */
import {readFile, readdir, access} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {studioSettingsSchema, type StudioSettings} from '../src/tenants/schema.ts';
import {flag} from './args.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tenantsDir = path.join(root, 'tenants');

type Level = 'error' | 'warn';

type Issue = {level: Level; text: string};

async function exists(p: string) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Проверки, которые важны для живого бизнеса, но не выражаются в схеме. */
export function audit(config: StudioSettings, photos: Set<string>): Issue[] {
  const issues: Issue[] = [];
  const add = (level: Level, text: string) => issues.push({level, text});

  // Фото, загруженные владельцем из кабинета, лежат в хранилище (https://…),
  // а не в photos/ — их файлом не проверяем.
  const local = (p: string) => !/^https?:\/\//.test(p);

  if (local(config.heroPhoto) && !photos.has(config.heroPhoto)) {
    add('error', `Главное фото ${config.heroPhoto} не найдено в photos/ — первый экран будет пустым`);
  }

  for (const item of config.gallery) {
    if (local(item.photo) && !photos.has(item.photo)) add('error', `Фото галереи ${item.photo} не найдено в photos/`);
  }

  if (config.logo && local(config.logo) && !photos.has(config.logo)) {
    add('error', `Логотип ${config.logo} не найден в photos/`);
  }

  const activeServices = config.services.filter((s) => s.isActive);
  if (activeServices.length === 0) add('error', 'Нет ни одной активной услуги — записаться невозможно');

  for (const s of activeServices) {
    if (s.price === 0) add('warn', `«${s.name}» — цена 0. Проверьте, так ли это задумано`);
  }

  const longServices = activeServices.filter((s) => s.days > 1);
  const longBoxes = config.boxes.filter((b) => b.isActive && b.acceptsLongStay);
  if (longServices.length > 0 && longBoxes.length === 0) {
    add(
      'error',
      `Есть многодневные услуги (${longServices.map((s) => s.name).join(', ')}), но ни один бокс не отмечен acceptsLongStay — их невозможно забронировать`,
    );
  }

  const activeBoxes = config.boxes.filter((b) => b.isActive);
  if (activeBoxes.length === 0) add('error', 'Нет активных боксов — нет мест для записи');

  const openDays = config.hours.filter((h) => h.open !== null);
  if (openDays.length === 0) add('error', 'Студия закрыта все дни недели — записываться некуда');

  if (!config.phone.trim()) add('error', 'Не указан телефон — подтверждать записи нечем');

  return issues;
}

async function validate() {
  const slugArg = flag('slug', process.argv.slice(2));
  const slugs = slugArg
    ? [slugArg]
    : (await readdir(tenantsDir, {withFileTypes: true}))
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();

  let failed = false;

  for (const slug of slugs) {
    const dir = path.join(tenantsDir, slug);
    const file = path.join(dir, 'studio.json');

    if (!(await exists(file))) {
      console.log(`✖ ${slug} — нет studio.json`);
      failed = true;
      continue;
    }

    const raw = JSON.parse(await readFile(file, 'utf8'));
    const parsed = studioSettingsSchema.safeParse(raw);

    if (!parsed.success) {
      console.log(`✖ ${slug} — не проходит схему:`);
      for (const i of parsed.error.issues) {
        console.log(`    • ${i.path.join('.') || '(корень)'}: ${i.message}`);
      }
      failed = true;
      continue;
    }

    if (parsed.data.slug !== slug) {
      console.log(`✖ ${slug} — slug в файле "${parsed.data.slug}" не совпадает с папкой`);
      failed = true;
      continue;
    }

    const photos = new Set(
      // Фото может не быть вовсе — тогда проверка фото даст понятную ошибку.
      await readdir(path.join(dir, 'photos')).catch(() => [] as string[]),
    );

    const issues = audit(parsed.data, photos);
    const errors = issues.filter((i) => i.level === 'error');
    const warns = issues.filter((i) => i.level === 'warn');

    if (errors.length === 0 && warns.length === 0) {
      console.log(`✓ ${slug} — ${parsed.data.name}: всё в порядке`);
      continue;
    }

    console.log(`${errors.length ? '✖' : '⚠'} ${slug} — ${parsed.data.name}`);
    for (const i of issues) console.log(`    ${i.level === 'error' ? '•' : '○'} ${i.text}`);
    if (errors.length > 0) failed = true;
  }

  if (failed) {
    console.error('\n❌ Есть ошибки — публиковать рано.');
    process.exit(1);
  }
  console.log('\n✓ Проверка пройдена.');
}

if (import.meta.filename === process.argv[1]) {
  validate().catch((err) => {
    console.error(String(err.message ?? err));
    process.exit(1);
  });
}
