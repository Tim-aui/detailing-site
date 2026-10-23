import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import {isSupabaseConfigured, supabaseAnonKey, supabaseUrl} from './supabaseConfig.ts';

/**
 * Клиент Supabase для браузера — для кабинета и всего, где нужна сессия.
 * Публичные страницы его не импортируют (см. publicApi.ts), поэтому он
 * не попадает в главный бандл.
 *
 * Здесь и в бандле — только публичные ключи (URL и anon key). Это
 * безопасно: RLS в базе решает, кому что видно. Секретный
 * service_role ключ живёт исключительно в Edge Functions.
 */
export {isSupabaseConfigured};

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Supabase не настроен. Задайте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY в .env.local — ' +
        'без них приложение работает в демо-режиме (только просмотр, без записи).',
    );
  }
  client ??= createClient(supabaseUrl, supabaseAnonKey, {
    auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true},
  });
  return client;
}
