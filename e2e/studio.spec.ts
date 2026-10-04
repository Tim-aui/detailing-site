import {test, expect, type Page} from '@playwright/test';
import {readFileSync, mkdirSync} from 'node:fs';

/**
 * Критерии готовности из задания, по порядку:
 *   клиент записывается → владелец видит запись в кабинете →
 *   занятое время не взять → помощник отвечает по данным →
 *   приложение устанавливается.
 */
const SLUG = process.env.E2E_SLUG ?? '1808-detailing';
const studio = JSON.parse(readFileSync(new URL(`../tenants/${SLUG}/studio.json`, import.meta.url), 'utf8'));
const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL ?? 'owner@1808.test';
const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD ?? 'Detailing-1808';
const SHOTS = process.env.E2E_SHOTS ?? 'e2e-shots';
mkdirSync(SHOTS, {recursive: true});
const shot = (page: Page, name: string) =>
  page.screenshot({path: `${SHOTS}/${test.info().project.name}-${name}.png`, fullPage: false});


/** Вход в кабинет: ждём либо форму, либо уже открытый кабинет. */
async function login(page: Page) {
  const form = page.getByLabel('Пароль');
  const cabinet = page.getByText('Кабинет владельца');
  await expect(form.or(page.getByRole('navigation', {name: 'Разделы кабинета'}))).toBeVisible();
  if (await form.isVisible()) {
    await page.getByLabel('Почта').fill(OWNER_EMAIL);
    await form.fill(OWNER_PASSWORD);
    await page.getByRole('button', {name: 'Войти'}).click();
  }
  await expect(page.getByRole('navigation', {name: 'Разделы кабинета'})).toBeVisible();
  await expect(cabinet).toBeVisible();
}

test.describe.configure({mode: 'serial'});

let clientName = '';
// Свой номер на каждый прогон (телефон / компьютер): один номер может
// записаться только раз в день, иначе второй прогон упрётся в это правило.
const clientPhone = (project: string) => (project === 'phone' ? '+7 918 555-44-33' : '+7 918 555-44-34');

test('клиент записывается: услуга → дата → свободное время → контакты', async ({page}, info) => {
  clientName = `Тест ${info.project.name} ${Date.now() % 10000}`;
  await page.goto(`/s/${SLUG}/`);
  await expect(page.getByRole('heading', {level: 1, name: studio.name})).toBeVisible();
  await shot(page, '01-home');

  await page.getByRole('link', {name: /Записаться онлайн/}).click();
  await expect(page.getByRole('heading', {name: 'Запись в студию'})).toBeVisible();
  await page.getByLabel('Выберите услугу').selectOption('wax');
  await page.locator('.date-chip:not(.date-chip--full)').first().click();
  await page.getByRole('radio', {name: /^\d{2}:\d{2}$/}).first().click();
  await page.getByLabel(/Как к вам обращаться/).fill(clientName);
  await page.getByLabel(/^Телефон/).fill(clientPhone(info.project.name));
  await page.getByLabel(/^Автомобиль/).fill('Toyota Camry');
  // Без согласия кнопка неактивна и есть подсказка.
  await expect(page.getByText('Отметьте согласие на обработку персональных данных')).toBeVisible();
  await expect(page.getByRole('button', {name: 'Записаться', exact: true})).toBeDisabled();
  await page.getByLabel('Согласен на обработку персональных данных').check();
  await shot(page, '02-booking-form');
  await page.getByRole('button', {name: 'Записаться', exact: true}).click();

  await expect(page.getByRole('heading', {name: 'Вы записаны'})).toBeVisible();
  // Напоминание: push, а где его нет — календарь.
  await expect(page.getByRole('button', {name: /Напомнить за день|Добавить в календарь/}).first()).toBeVisible();
  await shot(page, '03-booked');
});

test('согласие ведёт на политику с реквизитами студии', async ({page}) => {
  await page.goto(`/s/${SLUG}/booking`);
  await page.getByRole('link', {name: 'Политика обработки данных'}).click();
  await expect(page.getByRole('heading', {name: 'Политика обработки персональных данных'})).toBeVisible();
  await expect(page.getByText(studio.name).first()).toBeVisible();
  await expect(page.getByText(studio.phone).first()).toBeVisible();
});

test('тот же телефон не может занять второе время в тот же день', async ({page}, info) => {
  // Первая запись этим номером уже сделана в тесте клиента выше.
  await page.goto(`/s/${SLUG}/booking`);
  await page.getByLabel('Выберите услугу').selectOption('wax');
  await page.locator('.date-chip:not(.date-chip--full)').first().click();
  await page.getByRole('radio', {name: /^\d{2}:\d{2}$/}).last().click();
  await page.getByLabel(/Как к вам обращаться/).fill('Повтор');
  await page.getByLabel(/^Телефон/).fill(clientPhone(info.project.name));
  await page.getByLabel('Согласен на обработку персональных данных').check();
  await page.getByRole('button', {name: 'Записаться', exact: true}).click();
  await expect(page.getByText(/уже есть запись/).first()).toBeVisible();
  await shot(page, '04a-same-phone');
});

test('занятое время видно и недоступно', async ({page}) => {
  await page.goto(`/s/${SLUG}/booking`);
  await page.getByLabel('Выберите услугу').selectOption('polish');
  const full = page.locator('.date-chip--full').first();
  await expect(full).toBeVisible();
  await expect(full).toContainText('всё занято');
  await full.click();
  const busy = page.getByRole('radiogroup', {name: 'Время записи'}).getByRole('radio', {name: /занято/}).first();
  await expect(busy).toBeDisabled();
  await busy.scrollIntoViewIfNeeded();
  await shot(page, '04-busy');
});

test('помощник клиента отвечает по данным студии', async ({page}) => {
  test.skip(!studio.assistantEnabled, 'ИИ-помощник для клиентов выключен в studio.json');
  await page.goto(`/s/${SLUG}/assistant`);
  await page.getByRole('button', {name: 'Сколько стоит полировка?'}).click();
  const log = page.getByRole('log', {name: 'Сообщения с помощником'});
  const polish = studio.services.find((s: {id: string}) => s.id === 'polish');
  const rub = String(polish.price / 100).replace(/\B(?=(\d{3})+(?!\d))/g, '[\\s\\u00a0\\u202f]');
  await expect(log).toContainText(new RegExp(rub));
  await shot(page, '05-assistant');
});

test('владелец входит и видит запись клиента, меняет статус и принимает оплату', async ({page}) => {
  await page.goto(`/s/${SLUG}/admin`);
  await login(page);

  await page.getByRole('radio', {name: 'Неделя'}).click().catch(() => page.getByText('Неделя', {exact: true}).click());
  // Запись могла попасть на следующую неделю — листаем до 3 недель.
  const row = page.getByText(clientName, {exact: false}).first();
  const empty = page.getByText('На этой неделе записей нет');
  for (let i = 0; i < 3; i++) {
    await expect(row.or(empty).or(page.getByRole('listitem')).first()).toBeVisible();
    if (await row.isVisible()) break;
    await page.getByRole('button', {name: '›'}).click();
  }
  await expect(page.getByText(clientName, {exact: false}).first()).toBeVisible();
  await shot(page, '06-admin-bookings');

  await page.getByText(clientName, {exact: false}).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', {name: 'Подтвердить'}).click();
  await expect(dialog.getByText('Подтверждена').first()).toBeVisible();
  await dialog.getByRole('button', {name: 'Оплата'}).click();
  await dialog.getByRole('button', {name: 'Записать оплату'}).click();
  await expect(dialog.getByText(/3[\s\u00a0\u202f]500/).last()).toBeVisible();
  await shot(page, '07-admin-dialog');
});

test('владелец меняет подпись и фото одной карточки — остальные не трогаются', async ({page}) => {
  await page.goto(`/s/${SLUG}/admin/settings`);
  await login(page);
  await page.getByRole('navigation', {name: 'Разделы настроек'}).getByRole('button', {name: 'Фото'}).click();
  const captions = page.getByLabel('Подпись');
  await expect(captions.first()).toBeVisible();
  const before = await captions.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  const imgsBefore = await page.locator('.admin-photo').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src));

  const newCaption = `Подпись ${test.info().project.name} ${Date.now() % 1000}`;
  await captions.nth(2).fill(newCaption);
  await page.getByRole('button', {name: 'Сохранить подпись'}).nth(2).click();
  await expect(page.getByText('Подпись сохранена').first()).toBeVisible();

  await page.locator('input[type=file][aria-label="Заменить фото"]').nth(1).setInputFiles(new URL('../tenants/1808-detailing/photos/hero.jpg', import.meta.url).pathname);
  await expect(page.getByText('Фото заменено').first()).toBeVisible({timeout: 20_000});

  await expect.poll(async () => page.locator('.admin-photo').nth(1).getAttribute('src')).not.toBe(imgsBefore[1]);
  const after = await page.getByLabel('Подпись').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  const imgsAfter = await page.locator('.admin-photo').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src));
  expect(after.length).toBe(before.length);
  after.forEach((c, i) => expect(c).toBe(i === 2 ? newCaption : before[i]));
  // На вкладке «Фото» .admin-photo — только карточки галереи.
  const g0 = imgsAfter.length - after.length;
  imgsAfter.slice(g0).forEach((src, i) => (i === 1 ? expect(src).not.toBe(imgsBefore[g0 + i]) : expect(src).toBe(imgsBefore[g0 + i])));
  await shot(page, '08-admin-photos');

  // На сайте клиента — новая подпись.
  await page.goto(`/s/${SLUG}/`);
  await expect(page.getByText(newCaption)).toBeVisible();
});

test('устанавливается: манифест студии и service worker', async ({page, request}) => {
  await page.goto(`/s/${SLUG}/`);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', `/tenants/${SLUG}/manifest.webmanifest`);
  const m = await (await request.get(`/tenants/${SLUG}/manifest.webmanifest`)).json();
  expect(m.display).toBe('standalone');
  expect(m.start_url).toContain(`/s/${SLUG}`);
  for (const icon of m.icons) expect((await request.get(icon.src)).ok()).toBeTruthy();
  const sw = await page.evaluate(async () => {
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 10_000))]);
    return reg ? (reg as ServiceWorkerRegistration).active?.scriptURL ?? 'pending' : null;
  });
  expect(sw).toContain('/sw.js');
});
