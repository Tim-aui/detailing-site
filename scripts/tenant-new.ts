/**
 * Создание новой студии.
 *
 *   pnpm tenant:new --slug novaya-studiya --name "НОВАЯ СТУДИЯ"
 *
 * Копирует демо-студию в новую папку и помечает её образцом:
 * пока не отработает `tenant:publish`, адрес новой студии не должен
 * выглядеть готовым. Имя и slug — единственное, что нужно решить
 * сразу: адрес студии нельзя менять после публикации.
 */
import {mkdir, writeFile, readFile, cp, access} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {studioSettingsSchema} from '../src/tenants/schema.ts';
import {flag, requireFlag} from './args.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tenantsDir = path.join(root, 'tenants');

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type Args = {slug: string; name: string; from: string};

function parseArgs(argv: string[]): Args {
  return {
    slug: requireFlag('slug', argv, 'Пример: pnpm tenant:new --slug moya-studiya --name "Моя студия"'),
    name: requireFlag('name', argv, 'Пример: pnpm tenant:new --slug moya-studiya --name "Моя студия"'),
    from: flag('from', argv) ?? 'demo',
  };
}

async function exists(p: string) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function newTenant() {
  const {slug, name, from} = parseArgs(process.argv.slice(2));

  if (!SLUG_RE.test(slug)) {
    throw new Error(
      `❌ slug "${slug}" не подходит. Только латиница в нижнем регистре, цифры и дефисы: moya-studiya`,
    );
  }

  const dir = path.join(tenantsDir, slug);
  if (await exists(dir)) {
    throw new Error(`❌ Папка tenants/${slug} уже есть. Выберите другой slug — адрес нельзя менять после публикации.`);
  }

  const source = path.join(tenantsDir, from);
  if (!(await exists(path.join(source, 'studio.json')))) {
    throw new Error(`❌ Не нашёл образец tenants/${from}/studio.json`);
  }

  await mkdir(path.join(dir, 'photos'), {recursive: true});
  await cp(path.join(source, 'photos'), path.join(dir, 'photos'), {recursive: true});

  const raw = JSON.parse(await readFile(path.join(source, 'studio.json'), 'utf8'));
  raw.slug = slug;
  raw.name = name;
  raw.pwa.shortName = name.slice(0, 24);
  raw.tagline = 'Коротко о студии: чем занимаетесь и чем отличаетесь';
  raw.description = 'Расскажите, как проходит работа и что получает клиент.';
  raw.heroPhoto = 'hero.jpg';
  // Логотипа и фото новой студии ещё нет — генератор нарисует заглушку.
  raw.logo = null;

  const parsed = studioSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `❌ Не удалось собрать корректный studio.json:\n` +
        parsed.error.issues.map((i) => `   • ${i.path.join('.') || '(корень)'}: ${i.message}`).join('\n'),
    );
  }

  await writeFile(path.join(dir, 'studio.json'), JSON.stringify(parsed.data, null, 2) + '\n');
  // Метка образца: студия не выглядит опубликованной, пока не проверена.
  await writeFile(
    path.join(dir, 'sample.json'),
    JSON.stringify({reason: 'Новая студия. Проверьте данные и снимите метку: pnpm tenant:publish --slug ' + slug}, null, 2),
  );

  console.log(`
✓ Создана студия tenants/${slug}

Что сделать дальше:
  1. Положить главное фото в tenants/${slug}/photos/hero.jpg
  2. Поправить услуги, цены и часы в tenants/${slug}/studio.json
  3. Проверить:   pnpm tenant:validate --slug ${slug}
  4. Опубликовать: pnpm tenant:publish --slug ${slug}
  5. Пересобрать: pnpm tenant:sync
`);
}

if (import.meta.filename === process.argv[1]) {
  newTenant().catch((err) => {
    console.error(String(err.message ?? err));
    process.exit(1);
  });
}
