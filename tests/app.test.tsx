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
import {allSeeds} from '../src/lib/studio.ts';

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
    expect(await screen.findByRole('heading', {name: 'NORTH DETAIL'})).toBeInTheDocument();
  });

  it('выводит услуги с ценами', async () => {
    renderAt('/s/demo/');
    expect(await screen.findByText('Полировка кузова')).toBeInTheDocument();
    // Цена хранится в копейках: 1 590 000 копеек = 15 900 ₽.
    expect(screen.getAllByText(/15[\s ]900/).length).toBeGreaterThan(0);
  });

  it('показывает три карточки «почему мы»', async () => {
    renderAt('/s/demo/');
    expect(await screen.findByText('Гарантия на покрытие')).toBeInTheDocument();
    expect(screen.getByText('Работаем без пыли')).toBeInTheDocument();
    expect(screen.getByText('Фото до и после')).toBeInTheDocument();
  });

  it('нижняя навигация ведёт на три раздела', async () => {
    renderAt('/s/demo/');
    const nav = await screen.findByRole('navigation', {name: 'Основная навигация'});
    expect(within(nav).getByRole('link', {name: /Главная/})).toBeInTheDocument();
    expect(within(nav).getByRole('link', {name: /Услуги/})).toHaveAttribute('href', '/s/demo/services');
    expect(within(nav).getByRole('link', {name: /Моя запись/})).toHaveAttribute('href', '/s/demo/my-booking');
  });

  it('главное фото ведёт на страницу записи', async () => {
    const user = userEvent.setup();
    renderAt('/s/demo/');
    await user.click(await screen.findByRole('link', {name: /Записаться в студию/}));
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
    expect(await screen.findByText('Химчистка салона')).toBeInTheDocument();
    expect(screen.getByText('Керамическое покрытие')).toBeInTheDocument();
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

    const submit = screen.getByRole('button', {name: 'Записаться'});
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    // Без базы запись сохраняется локально, но экран успеха одинаковый.
    expect(await screen.findByRole('heading', {name: 'Вы записаны'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Добавить в календарь'})).toBeInTheDocument();
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
