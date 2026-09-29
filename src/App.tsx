import {lazy, Suspense} from 'react';
import {Navigate, Route, Routes, useLocation} from 'react-router-dom';
import {Center} from '@astryxdesign/core/Center';
import {VStack} from '@astryxdesign/core/Layout';
import {Text} from '@astryxdesign/core/Text';
import {Button} from '@astryxdesign/core/Button';
import {TenantLayout} from './routes/TenantLayout.tsx';
import {LoadingIndicator} from './components/LoadingIndicator.tsx';
import {HomePage} from './routes/HomePage.tsx';
import {allSeeds} from './lib/studio.ts';

// Главная входит в первый экран и грузится сразу. Остальное — по клику:
// страницы записи и помощника заметно тяжелее, а человеку они нужны
// не сразу, и держать их в первом бандле незачем.
const ServicesPage = lazy(() => import('./routes/ServicesPage.tsx').then((m) => ({default: m.ServicesPage})));
const BookingPage = lazy(() => import('./routes/BookingPage.tsx').then((m) => ({default: m.BookingPage})));
const MyBookingPage = lazy(() => import('./routes/MyBookingPage.tsx').then((m) => ({default: m.MyBookingPage})));
const AdminApp = lazy(() => import('./routes/admin/AdminApp.tsx'));
const AssistantPage = lazy(() => import('./routes/AssistantPage.tsx').then((m) => ({default: m.AssistantPage})));

/**
 * Маршруты приложения.
 *
 * Каждая студия живёт по адресу /s/<slug>/, поэтому один бандл
 * обслуживает любое число студий: Vercel отдаёт index.html на все
 * пути, slug разбирает клиент.
 */
export function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route
        path="/s/:slug/admin/*"
        element={
          <Suspense fallback={<LoadingIndicator label="Открываем кабинет" />}>
            <AdminApp />
          </Suspense>
        }
      />
      <Route path="/s/:slug" element={<TenantLayout />}>
        <Route index element={<HomePage />} />
        <Route
          path="services"
          element={
            <Suspense fallback={<LoadingIndicator label="Загружаем услуги" />}>
              <ServicesPage />
            </Suspense>
          }
        />
        <Route
          path="booking"
          element={
            <Suspense fallback={<LoadingIndicator label="Загружаем расписание" />}>
              <BookingPage />
            </Suspense>
          }
        />
        <Route
          path="my-booking"
          element={
            <Suspense fallback={<LoadingIndicator label="Загружаем записи" />}>
              <MyBookingPage />
            </Suspense>
          }
        />
        <Route
          path="assistant"
          element={
            <Suspense fallback={<LoadingIndicator label="Подключаем помощника" />}>
              <AssistantPage />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

/**
 * Короткий адрес без студии: уводим на первую студию из реестра.
 * Так ссылку можно раздать одну, а не плодить на каждый slug.
 */
function RootRedirect() {
  // Черновики не показываем: короткая ссылка должна вести в рабочую студию.
  const published = allSeeds().filter((t) => !t.isSample);
  const target = published[0] ?? allSeeds()[0];
  if (!target) return <NotFound />;
  return <Navigate to={`/s/${target.slug}/`} replace />;
}

function NotFound() {
  const location = useLocation();
  return (
    <Center minHeight="100dvh">
      <VStack gap={4} style={{textAlign: 'center', maxWidth: 460, padding: 24}}>
        <Text type="display-1" weight="bold">
          404
        </Text>
        <Text type="body" color="secondary">
          Страница {location.pathname} не найдена.
        </Text>
        <Button
          label="На главную"
          variant="primary"
          clickAction={() => {
            window.location.href = '/';
          }}
        />
      </VStack>
    </Center>
  );
}
