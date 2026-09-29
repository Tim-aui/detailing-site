/**
 * Загрузка студий в базу Supabase.
 *
 *   pnpm tenant:push                 # все студии
 *   pnpm tenant:push --slug demo     # одна
 *   pnpm tenant:push --dry           # только показать, что изменится
 *
 * Файл tenants/<slug>/studio.json остаётся источником правды: скрипт
 * кладёт его копию в таблицу tenants.config, чтобы сервер мог считать
 * занятость боксов и итоговую цену. Правки владельца хранятся отдельно
 * (tenant_settings.patch) и накладываются поверх — их скрипт не трогает.
 *
 * Ключи берутся из .env.local. Нужен service_role: RLS anon здесь закрыт.
 */
import process from 'node:process';
import {access} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {flag} from './args.ts';
import {collectTenants} from './tenant-sync.ts';
import {requireSupabase} from './supabase-client.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function exists(p: string) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function push() {
  const only = flag('slug', process.argv.slice(2));
  const dry = process.argv.includes('--dry');

  const all = await collectTenants();
  const entries = only ? all.filter((t) => t.slug === only) : all;

  if (entries.length === 0) {
    throw new Error(`❌ Студия ${only} не найдена в tenants/`);
  }

  if (dry) {
    for (const e of entries) {
      const published = !(await exists(path.join(root, 'tenants', e.slug, 'sample.json')));
      console.log(`${published ? 'опубликовать' : 'черновик  '} ${e.slug} — «${e.config.name}», услуг: ${e.config.services.length}`);
    }
    console.log('\nЭто был сухой запуск: база не изменена.');
    return;
  }

  const supabase = await requireSupabase();

  for (const e of entries) {
    const published = !(await exists(path.join(root, 'tenants', e.slug, 'sample.json')));

    const {error} = await supabase.from('tenants').upsert(
      {
        slug: e.slug,
        name: e.config.name,
        timezone: e.config.timezone,
        config: e.config,
        is_published: published,
      },
      {onConflict: 'slug'},
    );

    if (error) throw new Error(`❌ ${e.slug}: ${error.message}`);

    console.log(`✓ ${e.slug} — ${published ? 'опубликована' : 'черновик'} (услуг: ${e.config.services.length}, боксов: ${e.config.boxes.length})`);
  }

  console.log(`\nГотово: ${entries.length} студий в базе.`);
  console.log('Правки владельца не тронуты — они в tenant_settings.patch.');
}

if (import.meta.filename === process.argv[1]) {
  push().catch((err) => {
    console.error(String(err.message ?? err));
    process.exit(1);
  });
}
