/**
 * Доступ владельца к кабинету студии.
 *
 *   pnpm tenant:owner --slug moya-studiya --email owner@mail.ru
 *   pnpm tenant:owner --slug moya-studiya --email owner@mail.ru --password 'Секрет-123'
 *   pnpm tenant:owner --slug moya-studiya --email manager@mail.ru --role manager
 *   pnpm tenant:owner --slug moya-studiya --email owner@mail.ru --remove
 *
 * Без --password создаётся случайный пароль и печатается один раз —
 * передайте его владельцу. Если пользователь уже есть, пароль меняется
 * только при явном --password. Вход: <сайт>/s/<slug>/admin.
 *
 * Нужен SUPABASE_SERVICE_ROLE_KEY в .env.local (или --local).
 */
import process from 'node:process';
import {randomBytes} from 'node:crypto';
import {flag, requireFlag} from './args.ts';
import {requireSupabase} from './supabase-client.ts';

async function main() {
  const argv = process.argv.slice(2);
  const slug = requireFlag('slug', argv, 'Пример: pnpm tenant:owner --slug moya-studiya --email owner@mail.ru');
  const email = requireFlag('email', argv, 'Укажите почту владельца: --email owner@mail.ru').trim().toLowerCase();
  const role = flag('role', argv) ?? 'owner';
  if (role !== 'owner' && role !== 'manager') throw new Error('❌ --role: owner или manager');
  const supabase = await requireSupabase(argv);

  const {data: tenant, error: tErr} = await supabase.from('tenants').select('slug, name, is_published').eq('slug', slug).maybeSingle();
  if (tErr) throw new Error(`❌ ${tErr.message}`);
  if (!tenant) throw new Error(`❌ Студии ${slug} нет в базе. Сначала: pnpm tenant:push --slug ${slug}`);

  // Ищем пользователя по почте (постранично — у админ-API нет фильтра).
  let user: {id: string; email?: string} | undefined;
  for (let page = 1; page < 50 && !user; page++) {
    const {data, error} = await supabase.auth.admin.listUsers({page, perPage: 200});
    if (error) throw new Error(`❌ ${error.message}`);
    user = data.users.find((u) => u.email?.toLowerCase() === email);
    if (data.users.length < 200) break;
  }

  if (argv.includes('--remove')) {
    if (!user) return console.log(`— ${email} не найден, доступа и так нет`);
    const {error} = await supabase.from('tenant_members').delete().eq('tenant_slug', slug).eq('user_id', user.id);
    if (error) throw new Error(`❌ ${error.message}`);
    return console.log(`✓ ${email} больше не имеет доступа к «${tenant.name}»`);
  }

  let password = flag('password', argv);
  if (!user) {
    password ??= randomBytes(9).toString('base64url');
    const {data, error} = await supabase.auth.admin.createUser({email, password, email_confirm: true});
    if (error) throw new Error(`❌ Не удалось создать пользователя: ${error.message}`);
    user = data.user;
    console.log(`✓ Создан вход ${email}`);
  } else if (password) {
    const {error} = await supabase.auth.admin.updateUserById(user.id, {password});
    if (error) throw new Error(`❌ Не удалось сменить пароль: ${error.message}`);
    console.log(`✓ Пароль ${email} изменён`);
  } else {
    console.log(`✓ ${email} уже зарегистрирован — пароль прежний`);
  }

  const {error: mErr} = await supabase
    .from('tenant_members')
    .upsert({tenant_slug: slug, user_id: user!.id, role}, {onConflict: 'tenant_slug,user_id'});
  if (mErr) throw new Error(`❌ ${mErr.message}`);

  console.log(`✓ ${email} — ${role === 'owner' ? 'владелец' : 'менеджер'} «${tenant.name}»`);
  if (password && !flag('password', argv)) console.log(`\n  Пароль (показан один раз): ${password}`);
  console.log(`  Кабинет: <адрес сайта>/s/${slug}/admin${tenant.is_published ? '' : '  (студия ещё черновик: pnpm tenant:publish)'}`);
}

if (import.meta.filename === process.argv[1]) {
  main().catch((err) => {
    console.error(String(err.message ?? err));
    process.exit(1);
  });
}
