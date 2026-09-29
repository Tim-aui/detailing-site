/**
 * Записи клиента и помощник студии.
 *
 * Все операции идут через SQL RPC (SECURITY DEFINER):
 *   • create_booking — атомарная запись с проверкой занятости
 *   • my_bookings — записи по телефону (без аккаунта)
 *   • cancel_booking — отмена по коду + телефону
 *   • studio_free_slots — проверка свободных окон на сервере
 *   • assistant — Edge Function (отдельно)
 *
 * Прямых SELECT/INSERT в bookings нет — RLS закрыт.
 */
import {useState} from 'react';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {isSupabaseConfigured, supabase} from './supabase.ts';
import {useTenant} from '../tenants/TenantContext.tsx';
import type {BookingDraft, BookingRow} from './types.ts';

export function useMyBookings() {
  const {slug} = useTenant();
  return useQuery<BookingRow[]>({
    queryKey: ['my-bookings', slug],
    queryFn: async () => {
      if (!isSupabaseConfigured) return readLocal(slug);
      const phone = localStorage.getItem(`studio:phone:${slug}`) ?? '';
      if (!phone) return [];
      const {data, error} = await supabase().rpc('my_bookings', {
        p_tenant_slug: slug,
        p_phone: phone,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as BookingRow[];
    },
  });
}

export function useCreateBooking() {
  const qc = useQueryClient();
  const {slug} = useTenant();
  return useMutation({
    mutationFn: async (draft: BookingDraft) => {
      if (!isSupabaseConfigured) return createLocal(slug, draft);
      const {data, error} = await supabase().rpc('create_booking', {
        p_tenant_slug: slug,
        p_service_id: draft.serviceId,
        p_start: draft.startUtc,
        p_name: draft.contactName,
        p_phone: draft.contactPhone,
        p_car: draft.car,
        p_comment: draft.comment,
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      if (draft.contactPhone) localStorage.setItem(`studio:phone:${slug}`, draft.contactPhone);
      return data as {code: string; id: string; startUtc: string; endUtc: string; serviceName: string; price: number};
    },
    onSuccess: () => {
      qc.invalidateQueries({queryKey: ['my-bookings', slug]});
      qc.invalidateQueries({queryKey: ['busy', slug]});
    },
  });
}

export function useCancelBooking() {
  const qc = useQueryClient();
  const {slug} = useTenant();
  return useMutation({
    mutationFn: async ({code}: {code: string}) => {
      if (!isSupabaseConfigured) return cancelLocal(slug, code);
      const phone = localStorage.getItem(`studio:phone:${slug}`) ?? '';
      const {data, error} = await supabase().rpc('cancel_booking', {
        p_tenant_slug: slug,
        p_code: code,
        p_phone: phone,
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({queryKey: ['my-bookings', slug]});
      qc.invalidateQueries({queryKey: ['busy', slug]});
    },
  });
}

/** Серверная проверка слотов (опционально, для перестраховки перед записью). */
export function useStudioFreeSlots(serviceId: string | null, from?: string, to?: string) {
  const {slug} = useTenant();
  return useQuery({
    queryKey: ['free-slots', slug, serviceId, from, to],
    enabled: isSupabaseConfigured && !!serviceId,
    queryFn: async () => {
      const {data, error} = await supabase().rpc('studio_free_slots', {
        p_tenant_slug: slug,
        p_service_id: serviceId,
        p_from: from,
        p_to: to,
        p_limit: 200,
      });
      if (error) throw new Error(error.message);
      return data as {serviceId: string; slots: {startUtc: string; endUtc: string}[]};
    },
  });
}

type Message = {role: 'user' | 'assistant'; text: string};

export function useAssistant() {
  const {slug} = useTenant();
  const [_history, setHistory] = useState<Message[]>([]);
  return useMutation({
    mutationFn: async (question: string) => {
      if (!isSupabaseConfigured) throw new Error('Помощник подключается после настройки базы');
      const {data, error} = await supabase().functions.invoke('assistant', {
        body: {tenant_slug: slug, question, actor: `client:${localStorage.getItem(`studio:phone:${slug}`) ?? 'anon'}`},
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data as {answer: string};
    },
    onSuccess: (answer, question) =>
      setHistory((h) => [...h, {role: 'user' as const, text: question}, {role: 'assistant' as const, text: answer.answer}]),
  });
}

// --- локальный режим без базы ---------------------------------------------
// Нужен, чтобы студию можно было потрогать сразу после клонирования.
// Данные лежат в localStorage и никогда не попадают в интернет.

const LS = (slug: string) => `studio:bookings:${slug}`;

function readLocal(slug: string): BookingRow[] {
  try {
    return JSON.parse(localStorage.getItem(LS(slug)) ?? '[]') as BookingRow[];
  } catch {
    return [];
  }
}

function writeLocal(slug: string, rows: BookingRow[]) {
  localStorage.setItem(LS(slug), JSON.stringify(rows));
}

function createLocal(slug: string, draft: BookingDraft) {
  const rows = readLocal(slug);
  const code = Math.random().toString(36).slice(2, 6).toUpperCase();
  const row: BookingRow = {
    id: crypto.randomUUID(),
    code,
    tenant_slug: slug,
    service_name: draft.serviceName,
    starts_at: draft.startUtc,
    ends_at: draft.endUtc,
    status: 'pending',
    price: draft.price,
    contact_name: draft.contactName,
    contact_phone: draft.contactPhone,
    car: draft.car ?? '',
    comment: draft.comment ?? '',
    created_at: new Date().toISOString(),
  };
  writeLocal(slug, [...rows, row]);
  if (draft.contactPhone) localStorage.setItem(`studio:phone:${slug}`, draft.contactPhone);
  return {code, id: row.id, startUtc: draft.startUtc, endUtc: draft.endUtc};
}

function cancelLocal(slug: string, code: string) {
  writeLocal(
    slug,
    readLocal(slug).map((r) => (r.code === code ? {...r, status: 'cancelled' as const} : r)),
  );
  return {ok: true};
}