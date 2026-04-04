// src/components/layout/Sidebar.tsx
import { NavLink, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import {
  LayoutDashboard, Building2, Gauge, FileText, CreditCard,
  BarChart3, Settings, ChevronDown, ChevronRight,
  Users, Database, Percent, TrendingDown, AlertCircle,
} from 'lucide-react';
import { useState } from 'react';
import clsx from 'clsx';

interface NavChild {
  label: string;
  to: string;
  icon: React.ReactNode;
  roles?: string[];
}
interface NavItem {
  label: string;
  to?: string;
  icon: React.ReactNode;
  roles?: string[];
  children?: NavChild[];
}

const NAV: NavItem[] = [
  { label: 'Dashboard', to: '/dashboard', icon: <LayoutDashboard size={16} /> },
  {
    label: 'Units',
    icon: <Building2 size={16} />,
    roles: ['admin', 'billing_staff', 'cashier'],
    children: [
      { label: 'All Units', to: '/units', icon: <Building2 size={14} /> },
      { label: 'Bulk Import', to: '/units/import', icon: <Database size={14} />, roles: ['admin'] },
    ],
  },
  { label: 'Readings', to: '/readings', icon: <Gauge size={16} />, roles: ['admin', 'billing_staff'] },
  {
    label: 'Billing', icon: <FileText size={16} />,
    roles: ['admin', 'billing_staff'],
    children: [
      { label: 'Billing Cycles', to: '/billing', icon: <FileText size={14} /> },
    ],
  },
  {
    label: 'Payments', icon: <CreditCard size={16} />,
    roles: ['admin', 'cashier', 'billing_staff'],
    children: [
      { label: 'Unpaid Accounts', to: '/reports/unpaid', icon: <CreditCard size={14} /> },
      { label: 'Receipt Log', to: '/reports/collection', icon: <FileText size={14} /> },
      { label: 'Void Payment', to: '/payments/void', icon: <AlertCircle size={14} />, roles: ['admin'] },
    ],
  },
  {
    label: 'Reports', icon: <BarChart3 size={16} />,
    children: [
      { label: 'Admin Visuals', to: '/reports/visuals', icon: <BarChart3 size={14} />, roles: ['admin'] },
      { label: 'Billing Summary', to: '/reports/billing', icon: <BarChart3 size={14} /> },
      { label: 'Collection Summary', to: '/reports/collection', icon: <TrendingDown size={14} /> },
      { label: 'Unpaid Accounts', to: '/reports/unpaid', icon: <AlertCircle size={14} /> },
      { label: 'Aging Report', to: '/reports/aging', icon: <AlertCircle size={14} /> },
    ],
  },
  {
    label: 'Settings', icon: <Settings size={16} />,
    roles: ['admin'],
    children: [
      { label: 'Rates & Fees', to: '/settings/rates', icon: <Percent size={14} /> },
      { label: 'Users', to: '/settings/users', icon: <Users size={14} /> },
      { label: 'Backup & Restore', to: '/settings/backup', icon: <Database size={14} /> },
    ],
  },
];

function NavGroup({ item }: { item: NavItem }) {
  const location = useLocation();
  const { user } = useAuthStore();
  const visibleChildren = item.children?.filter(
    child => !child.roles || child.roles.includes(user?.role ?? '')
  ) ?? [];
  const isChildActive = visibleChildren.some(c => location.pathname.startsWith(c.to));
  const [open, setOpen] = useState(!!isChildActive);

  if (visibleChildren.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className={clsx(
          'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm',
          'text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors',
          isChildActive && 'text-gray-900 font-medium'
        )}
      >
        <span className="text-gray-400">{item.icon}</span>
        <span className="flex-1 text-left">{item.label}</span>
        {open
          ? <ChevronDown size={13} className="text-gray-400" />
          : <ChevronRight size={13} className="text-gray-400" />}
      </button>
      {open && (
        <div className="ml-4 mt-0.5 border-l border-gray-100 pl-3 space-y-0.5">
          {visibleChildren.map(c => (
            <NavLink
              key={c.to}
              to={c.to}
              className={({ isActive }) => clsx(
                'flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm transition-colors',
                isActive
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
              )}
            >
              <span>{c.icon}</span>
              {c.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const { user } = useAuthStore();

  return (
    <aside className="w-56 bg-white border-r border-gray-200 flex flex-col shrink-0">
      <div className="px-4 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
            <span className="text-white text-xs font-bold">NHA</span>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-900 truncate">Water Billing</p>
            <p className="text-[10px] text-gray-400 truncate">Camarin Residences</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {NAV
          .filter(item => !item.roles || item.roles.includes(user?.role ?? ''))
          .map(item =>
            item.to ? (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => clsx(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
                  isActive
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                )}
              >
                <span className="text-gray-400">{item.icon}</span>
                {item.label}
              </NavLink>
            ) : (
              <NavGroup key={item.label} item={item} />
            )
          )}
      </nav>

      <div className="px-3 py-3 border-t border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center shrink-0">
            <span className="text-xs font-medium text-gray-600">
              {user?.full_name.charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-gray-800 truncate">{user?.full_name}</p>
            <p className="text-[10px] text-gray-400 capitalize">{user?.role?.replace('_', ' ')}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
