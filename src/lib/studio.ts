/**
 * Доступ к данным студии.
 *
 * Настройки приходят в два слоя:
 *   1. `tenants/<slug>/studio.json` — попадает в сборку, работает
 *      всегда, даже без базы.
 *   2. Правки владельца из базы — накладываются поверх и побеждают.
 *
 * Слияние на клиенте нужно только для показа. Любые решения, влияющие
 * на деньги или занятость, сервер считает сам по базе.
 */
import {useQuery, type UseQueryResult} from '@tanstack/react-query';
import {TENANT_SEEDS} from '../tenants/generated/registry.ts';
import {mergeTenantConfig, type StudioSettings} from '../tenants/schema.ts';
import {isSupabaseConfigured, supabase} from './supabase.ts';
import type {BusyBlock} from './schedule.ts';
import {useTenant} from '../tenants/TenantContext.tsx';

export function seedFor(slug: string) {
  return TENANT_SEEDS.find((t) => t.slug === slug) ?? null;
}

export function allSeeds() {
  return TENANT_SEEDS;
}

/** Настройки студии: файл + правки владельца. */
export function useStudio(slug: string): UseQueryResult<StudioSettings, Error> {
  return useQuery({
    queryKey: ['studio', slug],
    // Правки владельца меняются редко — не дёргаем базу на каждый фокус.
    staleTime: 60_000,
    queryFn: async () => {
      const seed = seedFor(slug);
      if (!seed) throw new Error(`Студия «${slug}» не найдена`);
      if (!isSupabaseConfigured) return seed.config;

      const {data, error} = await supabase()
        .from('tenant_settings')
        .select('patch')
        .eq('slug', slug)
        .maybeSingle();
      if (error) {
        // Недоступная база не должна ломать просмотр студии:
        // показываем то, что гарантированно есть, — файл.
        console.warn('Не удалось прочитать настройки из базы, показываю файл студии:', error.message);
        return seed.config;
      }
      return mergeTenantConfig(seed.config, (data?.patch ?? null) as never);
    },
  });
}

/** Занятость боксов на горизонт записи. */
export function useBusy(slug: string, horizonDays: number): UseQueryResult<BusyBlock[], Error> {
  return useQuery({
    queryKey: ['busy', slug, horizonDays],
    staleTime: 20_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      if (!isSupabaseConfigured) return [];
      const {data, error} = await supabase()
        .from('bookings')
        .select('id, starts_at, ends_at, status')
        .eq('tenant_slug', slug)
        .in('status', ['pending', 'confirmed', 'in_progress', 'done'])
        .order('starts_at', {ascending: true});
      if (error) throw new Error(error.message);
      return (data ?? []).map((b) => ({
        id: b.id as string,
        startsAt: b.starts_at as string,
        endsAt: b.ends_at as string,
        status: b.status as BusyBlock['status'],
      }));
    },
  });
}

/** Настройки текущей студии из контекста роута. */
export function useCurrentStudio(): UseQueryResult<StudioSettings, Error> & {slug: string} {
  const {slug} = useTenant();
  return {...useStudio(slug), slug};
}
