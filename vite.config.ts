import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {VitePWA} from 'vite-plugin-pwa';

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
    VitePWA({
      // Манифест и иконки подставляются на клиенте per-tenant:
      // у каждой студии своё имя и свой логотип.
      injectRegister: null,
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Страницы приложения — network-first с офлайн-запасом.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Данные студии: сеть, при отсутствии сети — кэш (старые данные).
            urlPattern: ({url}) => url.pathname.startsWith('/tenants/'),
            handler: 'StaleWhileRevalidate',
            options: {cacheName: 'tenant-assets', expiration: {maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30}},
          },
          {
            // API Supabase: сеть + кэш только для чтения.
            urlPattern: ({url, request}) =>
              request.method === 'GET' && (url.hostname.endsWith('supabase.co')),
            handler: 'NetworkFirst',
            options: {cacheName: 'api-read', networkTimeoutSeconds: 5, expiration: {maxEntries: 120}},
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
  server: {port: 5173},
});
