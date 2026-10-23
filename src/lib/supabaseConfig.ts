/**
 * Адрес и публичный ключ Supabase — без самой библиотеки supabase-js.
 *
 * Отдельный модуль нужен ради размера главной: публичные страницы ходят
 * в базу через лёгкий fetch (publicApi.ts), а клиент supabase-js (~260 КБ)
 * грузится только в кабинете и там, где нужна сессия владельца.
 */
const rawUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
// Относительный адрес (/sb) — для стенда за одним доменом с сайтом.
export const supabaseUrl =
  rawUrl?.startsWith('/') && typeof window !== 'undefined' ? `${window.location.origin}${rawUrl}` : rawUrl;
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Без базы приложение работает в демо-режиме: показывает студию из файла. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
