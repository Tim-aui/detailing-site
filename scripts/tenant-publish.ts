/**
 * Публикация студии.
 *
 *   pnpm tenant:publish --slug moya-studiya
 *
 * Снимает метку образца после успешной проверки. Сначала запускается
 * tenant:validate — публиковать непроверенные данные нельзя, иначе
 * ошибка всплывёт уже у клиентов.
 */
import {unlink, readdir, access} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {syncTenants} from './tenant-sync.ts';
import {requireFlag} from './args.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tenantsDir = path.join(root, 'tenants');

async function exists(p: string) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function publish() {
  const slug = requireFlag('slug', process.argv.slice(2), 'Пример: pnpm tenant:publish --slug moya-studiya');

  const dir = path.join(tenantsDir, slug);
  if (!(await exists(path.join(dir, 'studio.json')))) {
    throw new Error(`❌ tenants/${slug}/studio.json не найден`);
  }

  const marker = path.join(dir, 'sample.json');
  if (!(await exists(marker))) {
    console.log(`✓ ${slug} уже опубликована — метки образца нет`);
    return;
  }

  // Те же проверки, что и в tenant:validate: публиковать данные, на
  // которых приложение упадёт у клиента, незачем.
  const {audit} = await import('./tenant-validate.ts');
  const {collectTenants} = await import('./tenant-sync.ts');

  // collectTenants бросит ошибку, если схема нарушена.
  const [entry] = await collectTenants().then((all) => all.filter((t) => t.slug === slug));
  if (!entry) throw new Error(`❌ tenants/${slug} не удалось прочитать`);

  const photos = new Set(
    await readdir(path.join(dir, 'photos')).catch(() => [] as string[]),
  );
  const issues = audit(entry.config, photos);
  const errors = issues.filter((i) => i.level === 'error');
  if (errors.length > 0) {
    console.error(`❌ ${slug} не проходит проверку:`);
    for (const i of issues) console.error(`    ${i.level === 'error' ? '•' : '○'} ${i.text}`);
    process.exit(1);
  }
  for (const i of issues) console.log(`    ○ ${i.text}`);

  await unlink(marker);
  console.log(`✓ ${slug} опубликована`);
  console.log('  Пересобираю артефакты студий…');
  await syncTenants();
  console.log('  Готово. Ссылка на студию: /s/' + slug + '/');
}

if (import.meta.filename === process.argv[1]) {
  publish().catch((err) => {
    console.error(String(err.message ?? err));
    process.exit(1);
  });
}
