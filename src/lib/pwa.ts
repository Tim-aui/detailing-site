import {useEffect} from 'react';
import {useLocation} from 'react-router-dom';

let done = false;
/** Новая версия сайта уже управляет вкладкой, а в памяти ещё старый код. */
let updated = false;

/**
 * Регистрация сервис-воркера и обновление сайта.
 *
 * Раньше новая версия ждала, пока закроют все вкладки сайта (а на телефоне
 * PWA почти никогда не закрывают), и событие «доступно обновление» никто не
 * слушал — люди неделями видели старую версию. Теперь воркер новой версии
 * включается сразу (skipWaiting + clientsClaim в vite.config.ts), а вкладка
 * перезагружается при первом удобном случае:
 *   • при следующем переходе внутри сайта (useReloadOnUpdate);
 *   • сразу, если вкладка в фоне.
 * Не посреди заполнения формы — введённое не пропадёт.
 *
 * Перезагрузка обязательна: старый код в памяти при переходе запросил бы
 * старые файлы, которых на сайте уже нет.
 */
export function registerPwa() {
  if (done || typeof window === 'undefined') return;
  done = true;
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) return;

  // Был ли воркер до нас: при первой установке перезагружать нечего.
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || updated) return;
    updated = true;
    if (document.visibilityState === 'hidden') window.location.reload();
  });

  const register = () => {
    navigator.serviceWorker
      .register('/sw.js', {scope: '/'})
      .then((reg) => {
        // Открытую надолго вкладку (PWA на телефоне) проверяем на обновления
        // при каждом возвращении к ней.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
          else if (updated) window.location.reload();
        });
      })
      .catch(() => {
        // Нет воркера — приложение просто работает без офлайна.
      });
  };

  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, {once: true});
}

/** Перезагружает страницу при переходе, если вышла новая версия сайта. */
export function useReloadOnUpdate() {
  const {pathname} = useLocation();
  useEffect(() => {
    if (updated) window.location.reload();
  }, [pathname]);
}
