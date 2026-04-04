import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { formatDate } from '../utils/formatters';
import { StatusBadge } from '../components/shared/StatusBadge';
import { Building2, Gauge, FileText, CreditCard, AlertTriangle, TrendingUp } from 'lucide-react';

interface CycleRow {
  id: number;
  period_start: string;
  period_end: string;
  status: string;
  readings_approved: number;
  total_units: number;
  bills_generated: number;
  readings_submitted: number;
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
}

function StatCard({ label, value, icon, color }: StatCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-gray-500 font-medium">{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
          {icon}
        </div>
      </div>
      <p className="text-2xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

export function Dashboard() {
  const { user, hasRole } = useAuthStore();
  const navigate = useNavigate();
  const [cycles, setCycles] = useState<CycleRow[]>([]);
  const [stats, setStats] = useState({ buildings: 0, activeUnits: 0 });

  useEffect(() => {
    invoke<CycleRow[]>('list_billing_cycles').then(data => setCycles(data.slice(0, 5)));
    invoke<any[]>('list_buildings').then(data => {
      setStats({
        buildings: data.length,
        activeUnits: data.reduce((sum, building) => sum + building.active_units, 0),
      });
    });
  }, []);

  const latestCycle = cycles[0];
  const canManageBilling = hasRole('admin', 'billing_staff');

  const quickActions = [
    {
      label: 'Sync Readings',
      icon: <Gauge size={15} />,
      to: '/readings/sync',
      color: 'text-blue-600 bg-blue-50 border-blue-200',
      visible: hasRole('admin', 'billing_staff'),
    },
    {
      label: 'Review Queue',
      icon: <AlertTriangle size={15} />,
      to: '/readings',
      color: 'text-orange-600 bg-orange-50 border-orange-200',
      visible: hasRole('admin', 'billing_staff'),
    },
    {
      label: 'Record Payment',
      icon: <CreditCard size={15} />,
      to: '/reports/unpaid',
      color: 'text-green-600 bg-green-50 border-green-200',
      visible: hasRole('admin', 'cashier'),
    },
    {
      label: 'Add Unit',
      icon: <Building2 size={15} />,
      to: '/units/new',
      color: 'text-purple-600 bg-purple-50 border-purple-200',
      visible: hasRole('admin', 'billing_staff'),
    },
  ].filter(action => action.visible);

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">
          Good {new Date().getHours() < 12 ? 'morning' : 'afternoon'}, {user?.full_name.split(' ')[0]}
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">Here&apos;s what&apos;s happening in Camarin Residences.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Buildings"
          value={stats.buildings}
          icon={<Building2 size={15} className="text-blue-600" />}
          color="bg-blue-50"
        />
        <StatCard
          label="Active Units"
          value={stats.activeUnits.toLocaleString()}
          icon={<TrendingUp size={15} className="text-green-600" />}
          color="bg-green-50"
        />
        {latestCycle && (
          <>
            <StatCard
              label="Readings Approved"
              value={`${latestCycle.readings_approved} / ${latestCycle.total_units}`}
              icon={<Gauge size={15} className="text-purple-600" />}
              color="bg-purple-50"
            />
            <StatCard
              label="Bills Generated"
              value={latestCycle.bills_generated}
              icon={<FileText size={15} className="text-orange-600" />}
              color="bg-orange-50"
            />
          </>
        )}
      </div>

      {latestCycle && latestCycle.status !== 'locked' && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-blue-900">
              Active cycle: {formatDate(latestCycle.period_start)} - {formatDate(latestCycle.period_end)}
            </p>
            <p className="text-xs text-blue-600 mt-0.5">
              {latestCycle.readings_approved} of {latestCycle.total_units} readings approved
              {' '}|{' '}
              {latestCycle.bills_generated} bills generated
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={latestCycle.status} />
            {canManageBilling && (
              <button
                onClick={() => navigate('/billing')}
                className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Manage
              </button>
            )}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-800">Recent Billing Cycles</h3>
          <button
            onClick={() => navigate('/billing')}
            className="text-xs text-blue-600 hover:text-blue-700"
          >
            View all {'>'}
          </button>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {cycles.length === 0 && (
            <div className="text-center py-10 text-sm text-gray-400">
              No billing cycles yet. Create one to get started.
            </div>
          )}
          {cycles.map(cycle => (
            <div
              key={cycle.id}
              onClick={() => navigate('/billing')}
              className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
            >
              <div>
                <p className="text-sm font-medium text-gray-800">
                  {formatDate(cycle.period_start)} - {formatDate(cycle.period_end)}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {cycle.readings_approved} approved | {cycle.bills_generated} billed
                </p>
              </div>
              <StatusBadge status={cycle.status} />
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-3">Quick Actions</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {quickActions.map(action => (
            <button
              key={action.to}
              onClick={() => navigate(action.to)}
              className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium transition-colors hover:opacity-80 ${action.color}`}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
