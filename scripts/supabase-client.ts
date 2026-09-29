/**
 * Подключение к Supabase из скриптов Node.
 *
 * Отдельный файл, потому что скриптам нужен service_role (он обходит RLS),
 * а приложению в браузере — только publishable/anon. Путать их нельзя:
 * ключ с префиксом VITE_ попадает в бандл.
 *
 * Переменные читаются из .env.local и из окружения процесса.
 */
import process from 'node:process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createClient, type SupabaseClient} from '@supabase/supabase-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Минимальный разбор .env.local: KEY=VALUE, кавычки и # комментарии. */
async function readEnvFile(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let raw: string;
  try {
    raw = await readFile(path.join(root, '.env.local'), 'utf8');
  } catch {
    return out;
  }

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export async function loadEnv(): Promise<Record<string, string>> {
  const fileEnv = await readEnvFile();
  const procEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) procEnv[k] = v;
  }
  return {...fileEnv, ...procEnv};
}

export interface SupabaseTarget {
  url: string;
  serviceRoleKey: string;
}

/**
 * Ключи локального стенда. Их нельзя взять из .env.local: облачный ключ
 * вместе с локальным адресом PostgREST не узнаёт и молча работает от
 * имени anon — а это сразу видно как «нарушение RLS» вместо внятной ошибки.
 */
async function localKeys(): Promise<{url: string; serviceRoleKey: string}> {
  const {execFile} = await import('node:child_process');
  const {promisify} = await import('node:util');
  const run = promisify(execFile);

  try {
    const {stdout} = await run('pnpm', ['supabase', 'status', '--output', 'env'], {cwd: root});
    const read = (name: string) => {
      const line = stdout.split('\n').find((l) => l.startsWith(`${name}=`));
      return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : '';
    };
    return {
      url: read('API_URL'),
      serviceRoleKey: read('SECRET_KEY') || read('SERVICE_ROLE_KEY'),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      '❌ Локальный Supabase не запущен.\n' +
        '   Запустите: pnpm supabase start\n' +
        `   Подробности: ${msg}`,
    );
  }
}

/**
 * Куда подключаться: локальный стенд (`--local`) или облако из .env.local.
 * По умолчанию облако — на нём сразу видно, что данные залиты в боевую базу.
 */
export async function requireSupabase(argv: string[] = process.argv.slice(2)): Promise<SupabaseClient> {
  const useLocal = argv.includes('--local');

  if (useLocal) {
    const local = await localKeys();
    return createClient(local.url, local.serviceRoleKey, {
      auth: {persistSession: false, autoRefreshToken: false},
    });
  }

  const env = await loadEnv();
  const url = env.VITE_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error(
      '❌ Не задан VITE_SUPABASE_URL.\n' +
        '   Скопируйте .env.example в .env.local и укажите адрес проекта.',
    );
  }
  if (!serviceRoleKey) {
    throw new Error(
      '❌ Не задан SUPABASE_SERVICE_ROLE_KEY.\n' +
        '   Он нужен скриптам администратора (загрузка студий, выдача прав владельцу).\n' +
        '   Взять: Supabase → Project Settings → API → Secret key.\n' +
        '   Файл .env.local не попадает в git.',
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {persistSession: false, autoRefreshToken: false},
  });
}
