import {createContext, useContext, type ReactNode} from 'react';
import {useParams} from 'react-router-dom';
import type {StudioSettings} from './schema.ts';

type TenantCtx = {slug: string; settings: StudioSettings | null};

/**
 * Текущая студия. slug приходит из адреса /s/<slug>/, настройки
 * подгружаются отдельно — контекст не ждёт сеть.
 */
export const TenantContext = createContext<TenantCtx>({slug: '', settings: null});

export function TenantProvider({slug, settings, children}: {slug: string; settings: StudioSettings | null; children: ReactNode}) {
  return <TenantContext.Provider value={{slug, settings}}>{children}</TenantContext.Provider>;
}

export function useTenantSlug(): string {
  return useContext(TenantContext).slug;
}

export function useTenant(): TenantCtx {
  return useContext(TenantContext);
}

/** slug из параметра маршрута. */
export function useSlugParam(): string {
  return useParams().slug ?? '';
}
