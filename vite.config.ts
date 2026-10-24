import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {VitePWA} from 'vite-plugin-pwa';
import {tenantSeoPages} from './scripts/vite-tenant-seo.ts';

/**
 * Оболочка сборки.
 *
 * Три вещи, которые нельзя забыть при добавлении студии:
 *  1. `tenant:sync` перегенерирует реестр, иконки и манифесты — он же
 *     выполняется перед dev и build, поэтому новая папка в tenants/
 *     сразу даёт рабочий адрес /s/<slug>/.
 *  2. `base: '/'` и `build.rollupOptions.input` — одна сборка на все студии.
 *  3. Workbox кэширует статику и страницы одинаково для всех слагов;
 *     данные Supabase идут только через сеть (см. runtimeCaching ниже).
 */
export default defineConfig({
  plugins: [
    react(),
    // dist/s/<slug>/…/index.html с title/og:* студии (см. scripts/vite-tenant-seo.ts).
    tenantSeoPages(),
    VitePWA({
      // Манифест и иконки подставляются на клиенте per-tenant:
      // у каждой студии своё имя и свой логотип.
      injectRegister: null,
      // Новая версия включается сразу; вкладка перезагружается при переходе
      // (см. src/lib/pwa.ts). Раньше было 'prompt', но подсказку никто не показывал.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'robots.txt'],
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Копии index.html для студий (ради og:*) кэшировать не нужно:
        // офлайн-навигацию обслуживает общий /index.html.
        globIgnores: ['s/**', 'tenants/**/og.jpg'],
        // Страницы приложения — network-first с офлайн-запасом.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/tenants\//, /^\/sb\//],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        // Напоминания о записи (web push) — обработчик в public/sw-push.js.
        importScripts: ['/sw-push.js'],
        runtimeCaching: [
          {
            // Данные студии: сеть, при отсутствии сети — кэш (старые данные).
            urlPattern: ({url}) => url.pathname.startsWith('/tenants/'),
            handler: 'StaleWhileRevalidate',
            options: {cacheName: 'tenant-assets', expiration: {maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30}},
          },
          {
            // API Supabase: сеть + кэш только для чтения.
            // Фото из хранилища Supabase: имена уникальны, можно кэшировать.
            urlPattern: ({url, request}) =>
              request.method === 'GET' &&
              ((url.hostname.endsWith('supabase.co') && url.pathname.startsWith('/storage/')) ||
                url.pathname.startsWith('/sb/storage/')),
            handler: 'CacheFirst',
            options: {cacheName: 'studio-media', expiration: {maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 60}},
          },
        ],
      },
      devOptions: {enabled: false},
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: {port: 5173, host: true},
});
