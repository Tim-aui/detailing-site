import {createClient, type SupabaseClient} from '@supabase/supabase-js';

/**
 * Клиент Supabase для браузера.
 *
 * Здесь и в бандле — только публичные ключи (URL и anon key). Это
 * безопасно: RLS в базе решает, кому что видно. Секретный
 * service_role ключ живёт исключительно в Edge Functions.
 */
const rawUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
// Относительный адрес (/sb) — для локального стенда за одним доменом с сайтом.
const url = rawUrl?.startsWith('/') && typeof window !== 'undefined' ? `${window.location.origin}${rawUrl}` : rawUrl;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Без базы приложение работает в демо-режиме: показывает студию из файла. */
export const isSupabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error(
      'Supabase не настроен. Задайте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY в .env.local — ' +
        'без них приложение работает в демо-режиме (только просмотр, без записи).',
    );
  }
  client ??= createClient(url, anonKey, {
    auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true},
  });
  return client;
}
