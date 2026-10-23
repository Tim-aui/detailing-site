/**
 * Публичные вызовы базы без supabase-js.
 *
 * Посетителю сайта не нужна сессия: все его операции — RPC под ролью anon
 * (studio_patch, studio_busy, create_booking, my_bookings, cancel_booking…).
 * Это обычный POST в PostgREST, поэтому тянуть ради него 260 КБ клиента
 * на главную незачем. Заголовки те же, что ставит supabase-js без сессии.
 */
import {isSupabaseConfigured, supabaseAnonKey, supabaseUrl} from './supabaseConfig.ts';

export {isSupabaseConfigured};

export type PublicResult<T> = {data: T | null; error: {message: string; code?: string; status?: number} | null};

function headers(): Record<string, string> {
  return {
    apikey: supabaseAnonKey ?? '',
    Authorization: `Bearer ${supabaseAnonKey ?? ''}`,
    'Content-Type': 'application/json',
  };
}

export async function rpcPublic<T = unknown>(name: string, params: Record<string, unknown>): Promise<PublicResult<T>> {
  if (!isSupabaseConfigured) return {data: null, error: {message: 'Supabase не настроен'}};
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(params),
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const message =
        res.status === 429 && !body?.message
          ? 'Слишком много запросов. Попробуйте через несколько минут.'
          : (body?.message ?? `Не получилось (код ${res.status}). Попробуйте ещё раз.`);
      return {data: null, error: {message, code: body?.code, status: res.status}};
    }
    return {data: body as T, error: null};
  } catch {
    // fetch падает только без сети / при блокировке адреса — его текст
    // («Failed to fetch») человеку ничего не скажет.
    return {data: null, error: {message: 'Нет связи. Проверьте интернет и попробуйте ещё раз.'}};
  }
}

/** Edge Function без сессии (помощник для клиентов). */
export async function invokePublic<T = unknown>(name: string, body: unknown): Promise<PublicResult<T>> {
  if (!isSupabaseConfigured) return {data: null, error: {message: 'Supabase не настроен'}};
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return {data: null, error: {message: data?.error ?? `Не получилось (код ${res.status}). Попробуйте ещё раз.`, status: res.status}};
    return {data: data as T, error: null};
  } catch {
    // fetch падает только без сети / при блокировке адреса — его текст
    // («Failed to fetch») человеку ничего не скажет.
    return {data: null, error: {message: 'Нет связи. Проверьте интернет и попробуйте ещё раз.'}};
  }
}
