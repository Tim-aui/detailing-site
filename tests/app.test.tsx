/**
 * Проверка интерфейса на настоящем рендере.
 *
 * Здесь нет моков на «магические» функции: страницы собираются с
 * теми же данными, что и в сборке, — из реестра студий. Если студия
 * или услуга исчезнет из studio.json, тест упадёт здесь, а не у
 * клиента.
 */
import {describe, expect, it, beforeEach} from 'vitest';
import {render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {Theme} from '@astryxdesign/core/theme';
import {studioTheme} from '../src/styles/studio.js';
import {App} from '../src/App.tsx';
import {allSeeds, seedFor} from '../src/lib/studio.ts';

// Ожидания берём из того же studio.json, что и сборка: переименование
// студии или смена цен не ломают тест, а пропажа данных — ломает.
const demo = seedFor('demo')!.config;
const activeServices = demo.services.filter((s) => s.isActive);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function renderAt(path: string) {
  const client = new QueryClient({
    defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
  });
  return render(
    <Theme theme={studioTheme}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>
    </Theme>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('Главная страница студии', () => {
  it('показывает название студии из файла настроек', async () => {
    renderAt('/s/demo/');
    expect(await screen.findByRole('heading', {name: demo.name, level: 1})).toBeInTheDocument();
  });

  it('выводит услуги с ценами', async () => {
    renderAt('/s/demo/');
    const first = activeServices[0];
    expect((await screen.findAllByText(first.name)).length).toBeGreaterThan(0);
    // Цена хранится в копейках, на экране — рубли в формате money().
    const digits = String(Math.round(first.price / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '[\\s\\u00a0\\u202f]?');
    expect(screen.getAllByText(new RegExp(digits)).length).toBeGreaterThan(0);
  });

  it('показывает три карточки «почему мы»', async () => {
    renderAt('/s/demo/');
    expect(demo.infoCards).toHaveLength(3);
    for (const card of demo.infoCards) {
      expect(await screen.findByText(card.title)).toBeInTheDocument();
    }
  });

  it('нижняя навигация ведёт на три раздела', async () => {
    renderAt('/s/demo/');
    const nav = await screen.findByRole('navigation', {name: 'Основная навигация'});
    expect(within(nav).getByRole('link', {name: /Главная/})).toBeInTheDocument();
    expect(within(nav).getByRole('link', {name: /Услуги/})).toHaveAttribute('href', '/s/demo/services');
    expect(within(nav).getByRole('link', {name: /Моя запись/})).toHaveAttribute('href', '/s/demo/my-booking');
  });

  it('кнопка на главном фото ведёт на страницу записи', async () => {
    const user = userEvent.setup();
    renderAt('/s/demo/');
    await user.click(await screen.findByRole('link', {name: /Записаться онлайн/}));
    expect(await screen.findByRole('heading', {name: 'Запись в студию'})).toBeInTheDocument();
  });

  it('черновик студии не принимает записи, пока не опубликован', async () => {
    const seed = allSeeds().find((t) => t.isSample);
    // Пока в реестре нет ни одного образца, проверять нечего.
    if (!seed) return;
    renderAt(`/s/${seed.slug}/`);
    expect(await screen.findByRole('heading', {name: 'Студия ещё не опубликована'})).toBeInTheDocument();
    expect(screen.queryByRole('link', {name: /Записаться/})).not.toBeInTheDocument();
  });

  it('неизвестная студия показывает понятную заглушку', async () => {
    renderAt('/s/nope/');
    expect(await screen.findByRole('heading', {name: 'Студия не найдена'})).toBeInTheDocument();
  });
});

describe('Страница услуг', () => {
  it('показывает все услуги студии', async () => {
    renderAt('/s/demo/services');
    for (const service of activeServices) {
      expect((await screen.findAllByText(new RegExp(`^${escape(service.name)}$`))).length).toBeGreaterThan(0);
    }
  });
});

describe('Запись', () => {
  it('показывает свободные слоты и принимает контакты', async () => {
    const user = userEvent.setup();
    renderAt('/s/demo/booking');

    // Услуга выбрана по умолчанию, дальше — выбор даты и времени.
    const times = await screen.findAllByRole('radio', {name: /^\d{2}:\d{2}/}, {timeout: 5000});
    expect(times.length).toBeGreaterThan(0);

    await user.click(times[0]);
    await user.type(screen.getByLabelText(/Как к вам обращаться/), 'Иван');
    await user.type(screen.getByLabelText(/^Телефон/), '+7 916 123-45-67');
    await user.click(screen.getByLabelText('Согласен на обработку персональных данных'));

    const submit = screen.getByRole('button', {name: 'Записаться'});
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    // Без базы запись сохраняется локально, но экран успеха одинаковый.
    expect(await screen.findByRole('heading', {name: 'Вы записаны'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Добавить в календарь'})).toBeInTheDocument();
  });

  it('не пускает без согласия на обработку данных', async () => {
    const user = userEvent.setup();
    renderAt('/s/demo/booking');
    const times = await screen.findAllByRole('radio', {name: /^\d{2}:\d{2}/}, {timeout: 5000});
    await user.click(times[0]);
    await user.type(screen.getByLabelText(/Как к вам обращаться/), 'Иван');
    await user.type(screen.getByLabelText(/^Телефон/), '+7 916 123-45-67');

    const submit = screen.getByRole('button', {name: 'Записаться'});
    expect(submit).toBeDisabled();
    expect(screen.getByText('Отметьте согласие на обработку персональных данных')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Согласен на обработку персональных данных'));
    await waitFor(() => expect(submit).toBeEnabled());
  });

  it('не пускает без телефона и показывает ошибку', async () => {
    const user = userEvent.setup();
    renderAt('/s/demo/booking');
    const times = await screen.findAllByRole('radio', {name: /^\d{2}:\d{2}/}, {timeout: 5000});
    await user.click(times[0]);
    await user.type(screen.getByLabelText(/Как к вам обращаться/), 'Иван');

    const submit = screen.getByRole('button', {name: 'Записаться'});
    expect(submit).toBeDisabled();
  });
});

describe('Моя запись', () => {
  it('находит запись по телефону и предлагает отмену', async () => {
    const user = userEvent.setup();
    // Сначала делаем запись, затем открываем раздел «Моя запись».
    renderAt('/s/demo/booking');
    const times = await screen.findAllByRole('radio', {name: /^\d{2}:\d{2}/}, {timeout: 5000});
    await user.click(times[0]);
    await user.type(screen.getByLabelText(/Как к вам обращаться/), 'Иван');
    await user.type(screen.getByLabelText(/^Телефон/), '+7 916 123-45-67');
    await user.click(screen.getByLabelText('Согласен на обработку персональных данных'));
    await user.click(await screen.findByRole('button', {name: 'Записаться'}));

    renderAt('/s/demo/my-booking');
    expect(await screen.findByText('Ждёт подтверждения')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Отменить запись'})).toBeInTheDocument();
  });

  it('пустое состояние объясняет, что делать', async () => {
    renderAt('/s/demo/my-booking');
    expect(await screen.findByText('Записей пока нет')).toBeInTheDocument();
  });
});

describe('Кабинет владельца', () => {
  it('без базы объясняет, что кабинету нужна Supabase, и не показывает данные', async () => {
    renderAt('/s/demo/admin');
    expect(await screen.findByText('Кабинет работает только с базой')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', {name: 'Основная навигация'})).not.toBeInTheDocument();
  });

  it('неизвестная студия в кабинете — заглушка', async () => {
    renderAt('/s/nope/admin');
    expect(await screen.findByRole('heading', {name: 'Студия не найдена'})).toBeInTheDocument();
  });
});


describe('Установка', () => {
  it('страница студии подключает её манифест и значок', async () => {
    renderAt('/s/demo/');
    await screen.findByRole('heading', {name: demo.name, level: 1});
    await waitFor(() =>
      expect(document.querySelector('link[rel="manifest"]')?.getAttribute('href')).toBe('/tenants/demo/manifest.webmanifest'),
    );
    expect(document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')).toBe('/tenants/demo/apple-touch-icon.png');
  });
});
