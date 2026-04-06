// src/components/layout/TopBar.tsx
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { LogOut } from 'lucide-react';
import toast from 'react-hot-toast';

const ROUTE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/units': 'Unit Management',
  '/units/new': 'Unit Details',
  '/units/import': 'Bulk Import Units',
  '/readings': 'Reading Review Queue',
  '/readings/sync': 'Sync from Mobile',
  '/billing/service-cases': 'Service Cases',
  '/billing': 'Billing Cycles',
  '/payments/queue': 'Payment Queue',
  '/reports/billing': 'Billing Summary',
  '/reports/collection': 'Collection Report',
  '/reports/unpaid': 'Unpaid Accounts',
  '/reports/aging': 'Aging Report',
  '/reports/visuals': 'Admin Visuals',
  '/settings/rates': 'Rates & Fees',
  '/settings/users': 'User Management',
  '/settings/backup': 'Backup & Restore',
};

export function TopBar() {
  const { pathname } = useLocation();
  const { logout } = useAuthStore();
  const navigate = useNavigate();

  const title = Object.entries(ROUTE_TITLES).find(([k]) =>
    pathname === k || pathname.startsWith(k + '/')
  )?.[1] ?? 'NHA Water Billing';

  const handleLogout = async () => {
    await logout();
    toast.success('Logged out.');
    navigate('/login');
  };

  return (
    <header className="h-12 bg-white border-b border-gray-200 px-6 flex items-center justify-between shrink-0">
      <h1 className="text-sm font-semibold text-gray-800">{title}</h1>
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-400">
          {new Date().toLocaleDateString('en-PH', {
            weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
          })}
        </span>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-red-600 transition-colors"
        >
          <LogOut size={13} />
          Sign out
        </button>
      </div>
    </header>
  );
}
