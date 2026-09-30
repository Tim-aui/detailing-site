import {Route, Routes} from 'react-router-dom';
import {AdminLayout} from './AdminLayout.tsx';
import {AdminBookings} from './AdminBookings.tsx';
import {AdminMoney} from './AdminMoney.tsx';
import {AdminSettings} from './AdminSettings.tsx';

/** Кабинет владельца — отдельный чанк: клиентам он не скачивается. */
export default function AdminApp() {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<AdminBookings />} />
        <Route path="money" element={<AdminMoney />} />
        <Route path="settings" element={<AdminSettings />} />
        <Route path="*" element={<AdminBookings />} />
      </Route>
    </Routes>
  );
}
