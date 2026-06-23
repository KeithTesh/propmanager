// web/src/router.tsx

import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { lazy, Suspense } from 'react';

// ─── PAGE IMPORTS ─────────────────────────────────────────────────────────────

const LoginPage          = lazy(() => import('./pages/auth/LoginPage'));
const SuperAdminPage     = lazy(() => import('./pages/superadmin/SuperAdminPage'));
const SetupWizard        = lazy(() => import('./pages/setup/SetupWizard'));
const DashboardLayout    = lazy(() => import('./components/layout/DashboardLayout'));
const DashboardHome      = lazy(() => import('./pages/dashboard/DashboardHome'));
const PropertiesPage     = lazy(() => import('./pages/properties/PropertiesPage'));
const PropertyDetailPage = lazy(() => import('./pages/properties/PropertyDetailPage'));
const TenantsPage        = lazy(() => import('./pages/tenants/TenantsPage'));
const LeasesPage         = lazy(() => import('./pages/leases/LeasesPage'));
const BillingPage        = lazy(() => import('./pages/billing/BillingPage'));
const PaymentsPage       = lazy(() => import('./pages/payments/PaymentsPage'));
const ReconciliationPage = lazy(() => import('./pages/reconciliation/ReconciliationPage'));
const NotificationsPage  = lazy(() => import('./pages/notifications/NotificationsPage'));
const MaintenancePage    = lazy(() => import('./pages/maintenance/MaintenancePage'));
const ExpensesPage       = lazy(() => import('./pages/expenses/ExpensesPage'));
const AuditPage          = lazy(() => import('./pages/audit/AuditPage'));
const ReportsPage        = lazy(() => import('./pages/reports/ReportsPage'));
const SettingsPage       = lazy(() => import('./pages/settings/SettingsPage'));
const SmsPage            = lazy(() => import('./pages/sms/SmsPage'));
const PayrollPage        = lazy(() => import('./pages/payroll/PayrollPage'));
const StaffPage          = lazy(() => import('./pages/staff/StaffPage'));
const TenantPortalPage   = lazy(() => import('./pages/portal/TenantPortalPage'));
const LandlordPortalPage  = lazy(() => import('./pages/landlord-portal/LandlordPortalPage'));
const LandlordsPage       = lazy(() => import('./pages/landlords/LandlordsPage'));
const LandlordDetailPage  = lazy(() => import('./pages/landlords/LandlordDetailPage'));
const RemittancesPage     = lazy(() => import('./pages/remittances/RemittancesPage'));

// ─── GUARDS ───────────────────────────────────────────────────────────────────

function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuthStore();
  const location = useLocation();
  if (isLoading) return <PageLoader />;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  return <Outlet />;
}

function SetupGuard() {
  const { user, company } = useAuthStore();
  if (user?.role === 'super_admin') return <Outlet />;
  if (user?.role === 'tenant') return <Outlet />;
  if (company && !company.setupCompleted) return <Navigate to="/setup" replace />;
  return <Outlet />;
}

function SetupRoute() {
  const company = useAuthStore((s) => s.company);
  if (company?.setupCompleted) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

function SuperAdminRoute() {
  const role = useAuthStore((s) => s.user?.role);
  if (role === 'super_admin') return <SuperAdminPage />;
  return <DashboardHome />;
}

function TenantGuard() {
  const role = useAuthStore((s) => s.user?.role);
  const location = useLocation();
  if (role === 'tenant' && !location.pathname.startsWith('/portal')) {
    return <Navigate to="/portal" replace />;
  }
  return <Outlet />;
}

// Landlord clients go to /landlord-portal only
function LandlordGuard() {
  const role = useAuthStore((s) => s.user?.role);
  const location = useLocation();
  if (role === 'landlord_client' && !location.pathname.startsWith('/landlord-portal')) {
    return <Navigate to="/landlord-portal" replace />;
  }
  return <Outlet />;
}

// ─── ROUTER ───────────────────────────────────────────────────────────────────

export function AppRouter() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>

        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        <Route element={<ProtectedRoute />}>

          <Route element={<SetupRoute />}>
            <Route path="/setup/*" element={<SetupWizard />} />
          </Route>

          <Route element={<SetupGuard />}>
            <Route path="/portal"          element={<TenantPortalPage />} />
            <Route path="/landlord-portal" element={<LandlordPortalPage />} />
          </Route>

          <Route element={<SetupGuard />}>
            <Route element={<LandlordGuard />}>
            <Route element={<TenantGuard />}>
              <Route element={<DashboardLayout />}>
                <Route path="/dashboard"      element={<SuperAdminRoute />} />
                <Route path="/properties"     element={<PropertiesPage />} />
                <Route path="/properties/:id" element={<PropertyDetailPage />} />
                <Route path="/tenants"        element={<TenantsPage />} />
                <Route path="/leases"         element={<LeasesPage />} />
                <Route path="/billing"        element={<BillingPage />} />
                <Route path="/payments"       element={<PaymentsPage />} />
                <Route path="/reconciliation" element={<ReconciliationPage />} />
                <Route path="/maintenance"    element={<MaintenancePage />} />
                <Route path="/expenses"       element={<ExpensesPage />} />
                <Route path="/audit"          element={<AuditPage />} />
                <Route path="/reports"        element={<ReportsPage />} />
                <Route path="/settings"       element={<SettingsPage />} />
                <Route path="/notifications"  element={<NotificationsPage />} />
                <Route path="/sms"            element={<SmsPage />} />
                <Route path="/payroll"        element={<PayrollPage />} />
                <Route path="/staff"          element={<StaffPage />} />
                <Route path="/landlords"      element={<LandlordsPage />} />
                <Route path="/landlords/:id"  element={<LandlordDetailPage />} />
                <Route path="/remittances"    element={<RemittancesPage />} />
              </Route>
            </Route>
            </Route>
          </Route>

        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />

      </Routes>
    </Suspense>
  );
}

function PageLoader() {
  return (
    <div style={{ display:'flex', height:'100vh', width:'100%', alignItems:'center', justifyContent:'center', background:'#f9fafb' }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ width:32, height:32, border:'3px solid #0d9f9f', borderTopColor:'transparent',
          borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto 12px' }} />
        <p style={{ color:'#6b7280', fontSize:14 }}>Loading…</p>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}