import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuthStore, type UserRole } from './store/authStore';
import { AppLayout } from './components/layout/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { Dashboard } from './pages/Dashboard';
import { UnitList } from './pages/Units/UnitList';
import { UnitForm } from './pages/Units/UnitForm';
import { BulkImport } from './pages/Units/BulkImport';
import { ReadingQueue } from './pages/Readings/ReadingQueue';
import { ReadingReview } from './pages/Readings/ReadingReview';
import { ManualEntry } from './pages/Readings/ManualEntry';
import { SyncImport } from './pages/Readings/SyncImport';
import { BillingCycleList } from './pages/Billing/BillingCycleList';
import { BillGenerate } from './pages/Billing/BillGenerate';
import { BillPreview } from './pages/Billing/BillPreview';
import { PaymentEntry } from './pages/Payments/PaymentEntry';
import { ReceiptView } from './pages/Payments/ReceiptView';
import { VoidPayment } from './pages/Payments/VoidPayment';
import { AccountLedger } from './pages/Ledger/AccountLedger';
import { BillingSummary } from './pages/Reports/BillingSummary';
import { CollectionReport } from './pages/Reports/CollectionReport';
import { UnpaidAccounts } from './pages/Reports/UnpaidAccounts';
import { AgingReport } from './pages/Reports/AgingReport';
import { AdminVisualReport } from './pages/Reports/AdminVisualReport';
import { RateConfig } from './pages/Settings/RateConfig';
import { UserManagement } from './pages/Settings/UserManagement';
import { BackupRestore } from './pages/Settings/BackupRestore';

function LoadingScreen() {
  return (
    <div className="flex h-screen items-center justify-center text-gray-500">
      Loading...
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthStore();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireRole({
  roles,
  children,
}: {
  roles: UserRole[];
  children: React.ReactNode;
}) {
  const { user, loading, hasRole } = useAuthStore();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!hasRole(...roles)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export default function App() {
  const { hydrate } = useAuthStore();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <BrowserRouter>
      <Toaster position="top-right" />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />

          <Route path="units" element={<UnitList />} />
          <Route
            path="units/new"
            element={
              <RequireRole roles={['admin', 'billing_staff']}>
                <UnitForm />
              </RequireRole>
            }
          />
          <Route
            path="units/import"
            element={
              <RequireRole roles={['admin']}>
                <BulkImport />
              </RequireRole>
            }
          />

          <Route
            path="readings"
            element={(
              <RequireRole roles={['admin', 'billing_staff']}>
                <ReadingQueue />
              </RequireRole>
            )}
          />
          <Route
            path="readings/manual/:cycleId"
            element={(
              <RequireRole roles={['admin', 'billing_staff']}>
                <ManualEntry />
              </RequireRole>
            )}
          />
          <Route
            path="readings/review/:cycleId"
            element={(
              <RequireRole roles={['admin', 'billing_staff']}>
                <ReadingReview />
              </RequireRole>
            )}
          />
          <Route
            path="readings/sync"
            element={(
              <RequireRole roles={['admin', 'billing_staff']}>
                <SyncImport />
              </RequireRole>
            )}
          />

          <Route path="billing" element={<BillingCycleList />} />
          <Route path="billing/:cycleId/generate" element={<BillGenerate />} />
          <Route path="billing/bill/:billId" element={<BillPreview />} />

          <Route
            path="payments/new/:billId"
            element={
              <RequireRole roles={['admin', 'cashier']}>
                <PaymentEntry />
              </RequireRole>
            }
          />
          <Route path="payments/receipt/:paymentId" element={<ReceiptView />} />
          <Route
            path="payments/void"
            element={
              <RequireRole roles={['admin']}>
                <VoidPayment />
              </RequireRole>
            }
          />

          <Route path="ledger/:accountId" element={<AccountLedger />} />

          <Route path="reports/billing" element={<BillingSummary />} />
          <Route path="reports/collection" element={<CollectionReport />} />
          <Route path="reports/unpaid" element={<UnpaidAccounts />} />
          <Route path="reports/aging" element={<AgingReport />} />
          <Route
            path="reports/visuals"
            element={
              <RequireRole roles={['admin']}>
                <AdminVisualReport />
              </RequireRole>
            }
          />

          <Route
            path="settings/rates"
            element={
              <RequireRole roles={['admin']}>
                <RateConfig />
              </RequireRole>
            }
          />
          <Route
            path="settings/users"
            element={
              <RequireRole roles={['admin']}>
                <UserManagement />
              </RequireRole>
            }
          />
          <Route
            path="settings/backup"
            element={
              <RequireRole roles={['admin']}>
                <BackupRestore />
              </RequireRole>
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
