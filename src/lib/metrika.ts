/**
 * Яндекс.Метрика студии (FIXES.md, 3.7).
 *
 * Номер счётчика — поле metrikaId в настройках студии (владелец вводит его
 * в кабинете), а не константа в коде: у каждой студии своя статистика.
 * Вебвизор выключен: он записывает ввод на странице записи (имя, телефон),
 * а это лишние персональные данные.
 *
 * Скрипт грузится асинхронно и только если номер задан, поэтому на скорость
 * первой отрисовки не влияет.
 */
import {useEffect} from 'react';
import {useLocation} from 'react-router-dom';

type Ym = ((id: number, method: string, ...args: unknown[]) => void) & {a?: unknown[]; l?: number};

declare global {
  interface Window {
    ym?: Ym;
  }
}

let activeId: number | null = null;
const initialized = new Set<number>();

function loadTag() {
  if (window.ym) return;
  const ym = function (...args: unknown[]) {
    (ym.a = ym.a || []).push(args);
  } as Ym;
  ym.l = Date.now();
  window.ym = ym;
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://mc.yandex.ru/metrika/tag.js';
  document.head.appendChild(s);
}

/** Подключает счётчик студии и отправляет просмотры при переходах SPA. */
export function useMetrika(metrikaId: string | undefined | null) {
  const location = useLocation();
  const id = metrikaId && /^\d+$/.test(metrikaId) ? Number(metrikaId) : null;

  useEffect(() => {
    if (!id || typeof window === 'undefined' || import.meta.env.DEV) return;
    loadTag();
    if (!initialized.has(id)) {
      initialized.add(id);
      window.ym!(id, 'init', {
        defer: true, // просмотры отправляем сами — на каждый переход роутера
        clickmap: true,
        trackLinks: true,
        accurateTrackBounce: true,
        webvisor: false,
      });
    }
    activeId = id;
    return () => {
      if (activeId === id) activeId = null;
    };
  }, [id]);

  useEffect(() => {
    if (!id || !window.ym || import.meta.env.DEV) return;
    window.ym(id, 'hit', window.location.href, {title: document.title, referer: document.referrer});
  }, [id, location.pathname]);
}

/** Цель Метрики, например booking_created после успешной записи. */
export function reachGoal(goal: string, params?: Record<string, unknown>) {
  if (activeId && window.ym) window.ym(activeId, 'reachGoal', goal, params);
}
