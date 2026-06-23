// web/src/pages/portal/TenantPortalPage.tsx

import { Routes, Route, Navigate } from 'react-router-dom';
import PortalLayout from './PortalLayout';
import PortalHome from './PortalHome';
import PortalBills from './PortalBills';
import PortalBillDetail from './PortalBillDetail';
import PortalPayments from './PortalPayments';
import PortalMaintenance from './PortalMaintenance';
import PortalProfile from './PortalProfile';
import PortalChangePassword from './PortalChangePassword';

export default function TenantPortalPage() {
  return (
    <Routes>
      <Route element={<PortalLayout />}>
        <Route index element={<PortalHome />} />
        <Route path="bills" element={<PortalBills />} />
        <Route path="bills/:id" element={<PortalBillDetail />} />
        <Route path="payments" element={<PortalPayments />} />
        <Route path="maintenance" element={<PortalMaintenance />} />
        <Route path="profile" element={<PortalProfile />} />
        <Route path="change-password" element={<PortalChangePassword />} />
        <Route path="*" element={<Navigate to="/portal" replace />} />
      </Route>
    </Routes>
  );
}
