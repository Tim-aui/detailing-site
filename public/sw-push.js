/* Обработчик web push: подключается в сервис-воркер Workbox через
   importScripts (см. vite.config.ts). Показывает напоминание о записи и
   открывает «Мою запись» по нажатию. */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {body: event.data ? event.data.text() : ''};
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Напоминание о записи', {
      body: data.body || '',
      tag: data.tag,
      data: {url: data.url || '/'},
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({type: 'window', includeUncontrolled: true}).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
