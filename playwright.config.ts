import {defineConfig, devices} from '@playwright/test';

/**
 * Сквозные проверки на телефоне и компьютере против РАБОТАЮЩЕГО стенда:
 * сайт + Supabase (облако или локальный стенд из docs/SETUP.md).
 *
 *   E2E_BASE_URL=https://… E2E_OWNER_EMAIL=… E2E_OWNER_PASSWORD=… pnpm test:e2e
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: {timeout: 10_000},
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8080',
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {name: 'phone', use: {...devices['Pixel 7']}},
    {name: 'desktop', use: {...devices['Desktop Chrome'], viewport: {width: 1440, height: 900}}},
  ],
});
