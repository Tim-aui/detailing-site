import {useEffect} from 'react';

let done = false;

/**
 * Регистрация сервис-воркера.
 *
 * Плагин отдаёт код воркера, но регистрирует его вручную: так мы
 * решаем, когда именно предложить установку, и не мешаем первой
 * отрисовке страницы.
 */
export function registerPwa() {
  if (done || typeof window === 'undefined') return;
  done = true;
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) return;

  const register = () => {
    navigator.serviceWorker
      .register('/sw.js', {scope: '/'})
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          sw?.addEventListener('statechange', () => {
            // Новый воркер готов и ждёт — перезагружаем, чтобы человек
            // не остался на старой версии приложения.
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              window.dispatchEvent(new CustomEvent('app:update-ready'));
            }
          });
        });
      })
      .catch(() => {
        // Нет воркера — приложение просто работает без офлайна.
      });
  };

  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, {once: true});
}

/** Событие «доступно обновление» для показа кнопки. */
export function onUpdateReady(handler: () => void) {
  useEffect(() => {
    window.addEventListener('app:update-ready', handler);
    return () => window.removeEventListener('app:update-ready', handler);
  }, [handler]);
}
