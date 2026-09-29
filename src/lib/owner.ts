/**
 * Кабинет владельца: вход, записи, деньги, настройки, фото.
 *
 * Всё идёт через RPC с проверкой прав в базе (owner_* в миграции
 * 20260102000000_owner_cabinet.sql). Браузер ничего не решает сам:
 * даже если подменить slug в адресе, база ответит «Нет доступа».
 */
import {useEffect, useState} from 'react';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import type {Session} from '@supabase/supabase-js';
import {addDays, startOfWeek} from 'date-fns';
import {formatInTimeZone, fromZonedTime, toZonedTime} from 'date-fns-tz';
import {isSupabaseConfigured, supabase} from './supabase.ts';
import type {BookingStatus} from './schedule.ts';
import type {OwnerEditableKey, StudioSettings} from '../tenants/schema.ts';

export type OwnerBooking = {
  id: string;
  code: string;
  service_id: string;
  service_name: string;
  box_id: string;
  starts_at: string;
  ends_at: string;
  status: BookingStatus;
  price: number;
  paid: number;
  source: 'client' | 'owner';
  contact_name: string;
  contact_phone: string;
  car: string;
  comment: string;
  created_at: string;
};

export type OwnerStats = {
  visits: number;
  done: number;
  pending: number;
  cancelled: number;
  expected: number;
  received: number;
  refunds: number;
};

export type OwnerPayment = {
  id: string;
  booking_id: string | null;
  booking_code: string | null;
  service_name: string | null;
  contact_name: string | null;
  kind: 'payment' | 'refund';
  amount: number;
  method: 'cash' | 'card' | 'transfer' | 'other';
  note: string;
  created_at: string;
};

export type Period = {from: Date; to: Date; label: string};

// ---------------------------------------------------------------------------
// Сессия
// ---------------------------------------------------------------------------

export function useSession(): {session: Session | null; isLoading: boolean} {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const sb = supabase();
    sb.auth.getSession().then(({data}) => {
      setSession(data.session);
      setLoading(false);
    });
    const {data} = sb.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  return {session, isLoading};
}

export async function signIn(email: string, password: string) {
  const {error} = await supabase().auth.signInWithPassword({email: email.trim(), password});
  if (error) {
    throw new Error(error.message === 'Invalid login credentials' ? 'Неверная почта или пароль' : error.message);
  }
}

export async function signOut() {
  await supabase().auth.signOut();
}

/** Студии пользователя. Пустой список = у этой почты нет доступа к кабинету. */
export function useMyStudios(userId: string | undefined) {
  return useQuery({
    // id пользователя в ключе: после смены аккаунта — свежий список.
    queryKey: ['owner', 'studios', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const {data, error} = await supabase().rpc('my_studios');
      if (error) throw new Error(error.message);
      return (data ?? []) as {slug: string; name: string; role: 'owner' | 'manager' | 'staff'; is_published: boolean}[];
    },
  });
}

// ---------------------------------------------------------------------------
// Период: день / неделя в поясе студии
// ---------------------------------------------------------------------------

export function periodFor(kind: 'day' | 'week', anchorDate: string, tz: string): Period {
  if (kind === 'day') {
    const from = fromZonedTime(`${anchorDate} 00:00`, tz);
    const next = formatInTimeZone(addDays(toZonedTime(from, tz), 1), tz, 'yyyy-MM-dd');
    return {from, to: fromZonedTime(`${next} 00:00`, tz), label: anchorDate};
  }
  const local = toZonedTime(fromZonedTime(`${anchorDate} 12:00`, tz), tz);
  const monday = startOfWeek(local, {weekStartsOn: 1});
  const mondayStr = formatDateLocal(monday);
  const nextMondayStr = formatDateLocal(addDays(monday, 7));
  return {
    from: fromZonedTime(`${mondayStr} 00:00`, tz),
    to: fromZonedTime(`${nextMondayStr} 00:00`, tz),
    label: mondayStr,
  };
}

export function todayIn(tz: string): string {
  return formatInTimeZone(new Date(), tz, 'yyyy-MM-dd');
}

export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDateLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Чтение
// ---------------------------------------------------------------------------

export function useOwnerBookings(slug: string, period: Period) {
  return useQuery({
    queryKey: ['owner', 'bookings', slug, period.from.toISOString(), period.to.toISOString()],
    refetchInterval: 60_000,
    queryFn: async () => {
      const {data, error} = await supabase().rpc('owner_bookings', {
        p_tenant_slug: slug,
        p_from: period.from.toISOString(),
        p_to: period.to.toISOString(),
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as OwnerBooking[];
    },
  });
}

export function useOwnerStats(slug: string, period: Period) {
  return useQuery({
    queryKey: ['owner', 'stats', slug, period.from.toISOString(), period.to.toISOString()],
    refetchInterval: 60_000,
    queryFn: async () => {
      const {data, error} = await supabase().rpc('owner_stats', {
        p_tenant_slug: slug,
        p_from: period.from.toISOString(),
        p_to: period.to.toISOString(),
      });
      if (error) throw new Error(error.message);
      return data as OwnerStats;
    },
  });
}

export function useOwnerPayments(slug: string, period: Period) {
  return useQuery({
    queryKey: ['owner', 'payments', slug, period.from.toISOString(), period.to.toISOString()],
    queryFn: async () => {
      const {data, error} = await supabase().rpc('owner_payments', {
        p_tenant_slug: slug,
        p_from: period.from.toISOString(),
        p_to: period.to.toISOString(),
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as OwnerPayment[];
    },
  });
}

// ---------------------------------------------------------------------------
// Изменения
// ---------------------------------------------------------------------------

function useOwnerMutation<TArgs, TResult>(slug: string, fn: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({queryKey: ['owner']});
      qc.invalidateQueries({queryKey: ['busy', slug]});
    },
  });
}

async function rpc<T>(name: string, params: Record<string, unknown>): Promise<T> {
  const {data, error} = await supabase().rpc(name, params);
  if (error) throw new Error(error.message);
  return data as T;
}

export function useSetStatus(slug: string) {
  return useOwnerMutation(slug, ({id, status}: {id: string; status: BookingStatus}) =>
    rpc('owner_set_status', {p_booking_id: id, p_status: status}),
  );
}

export function useReschedule(slug: string) {
  return useOwnerMutation(slug, ({id, startUtc}: {id: string; startUtc: string}) =>
    rpc('owner_reschedule_booking', {p_booking_id: id, p_start: startUtc}),
  );
}

export function useAddPayment(slug: string) {
  return useOwnerMutation(
    slug,
    (a: {id: string; kind: 'payment' | 'refund'; amount: number; method: OwnerPayment['method']; note: string}) =>
      rpc('owner_add_payment', {
        p_booking_id: a.id,
        p_kind: a.kind,
        p_amount: a.amount,
        p_method: a.method,
        p_note: a.note,
      }),
  );
}

export function useOwnerCreateBooking(slug: string) {
  return useOwnerMutation(
    slug,
    (a: {serviceId: string; startUtc: string; name: string; phone: string; car: string; comment: string; requestId: string}) =>
      rpc<{code: string}>('owner_create_booking', {
        p_tenant_slug: slug,
        p_service_id: a.serviceId,
        p_start: a.startUtc,
        p_name: a.name,
        p_phone: a.phone,
        p_car: a.car,
        p_comment: a.comment,
        p_request_id: a.requestId,
      }),
  );
}

/** Сохраняет только переданные ключи — остальные правки не трогает. */
export function useSaveSettings(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Pick<StudioSettings, OwnerEditableKey>>) =>
      rpc('owner_save_settings', {p_tenant_slug: slug, p_patch: patch}),
    onSuccess: () => {
      qc.invalidateQueries({queryKey: ['studio', slug]});
      qc.invalidateQueries({queryKey: ['owner']});
    },
  });
}

// ---------------------------------------------------------------------------
// Фото
// ---------------------------------------------------------------------------

const BUCKET = 'studio-media';

/**
 * Загружает фото в папку студии под уникальным именем и возвращает
 * публичную ссылку. Уникальное имя — ключевое: загрузка нового фото не
 * может затереть другое, а кэш браузера и CDN не покажет старую картинку.
 */
export async function uploadStudioPhoto(slug: string, file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Нужна картинка: JPG, PNG или WebP');
  if (file.size > 8 * 1024 * 1024) throw new Error('Фото больше 8 МБ — уменьшите его');
  const prepared = await downscale(file, 2000);
  const ext = prepared.type === 'image/webp' ? 'webp' : prepared.type === 'image/png' ? 'png' : 'jpg';
  const path = `${slug}/${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const sb = supabase();
  const {error} = await sb.storage.from(BUCKET).upload(path, prepared, {
    contentType: prepared.type,
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Большие фото с телефона (12+ Мп) ужимаем до 2000 px по длинной стороне. */
async function downscale(file: File, maxSide: number): Promise<Blob & {type: string}> {
  if (typeof createImageBitmap !== 'function' || file.type === 'image/gif') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.86));
    return blob ?? file;
  } catch {
    return file;
  }
}
