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

/** Студия, у которой этот адрес был раньше (после переименования). */
export function renamedSeedFor(oldSlug: string) {
  if (seedFor(oldSlug)) return null;
  return TENANT_SEEDS.find((t) => t.config.previousSlugs.includes(oldSlug)) ?? null;
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

      // Раньше здесь был select по несуществующей колонке `slug` (в таблице
      // она называется tenant_slug) — запрос всегда падал, и правки
      // владельца на сайте не появлялись никогда.
      const {data, error} = await supabase().rpc('studio_patch', {p_tenant_slug: slug});
      if (error) {
        // Недоступная база не должна ломать просмотр студии:
        // показываем то, что гарантированно есть, — файл.
        console.warn('Не удалось прочитать настройки из базы, показываю файл студии:', error.message);
        return seed.config;
      }
      return mergeTenantConfig(seed.config, (data ?? null) as never);
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
      if (!isSupabaseConfigured) return localBusy(slug);
      // Таблица bookings закрыта RLS, прямой select из браузера всегда
      // возвращал пусто — занятое время не отмечалось. studio_busy отдаёт
      // только интервалы и бокс, без имён и телефонов.
      const {data, error} = await supabase().rpc('studio_busy', {p_tenant_slug: slug});
      if (error) throw new Error(error.message);
      return ((data ?? []) as Array<{box_id: string; starts_at: string; ends_at: string; status: BusyBlock['status']}>).map(
        (b, i) => ({
          id: `${b.box_id}:${i}`,
          boxId: b.box_id,
          startsAt: b.starts_at,
          endsAt: b.ends_at,
          status: b.status,
        }),
      );
    },
  });
}

/** Демо без базы: занятость из записей, сделанных в этом браузере. */
function localBusy(slug: string): BusyBlock[] {
  try {
    const rows = JSON.parse(localStorage.getItem(`studio:bookings:${slug}`) ?? '[]') as Array<{
      id: string;
      starts_at: string;
      ends_at: string;
      status: BusyBlock['status'];
    }>;
    return rows
      .filter((r) => r.status !== 'cancelled')
      .map((r) => ({id: r.id, startsAt: r.starts_at, endsAt: r.ends_at, status: r.status}));
  } catch {
    return [];
  }
}

/** Настройки текущей студии из контекста роута. */
export function useCurrentStudio(): UseQueryResult<StudioSettings, Error> & {slug: string} {
  const {slug} = useTenant();
  return {...useStudio(slug), slug};
}
