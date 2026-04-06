import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ChevronRight, HelpCircle, Plus, X } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { DataTable, type Column } from '../../components/shared/DataTable';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { formatDate } from '../../utils/formatters';

interface CycleRow {
  id: number;
  period_start: string;
  period_end: string;
  status: string;
  rate_per_cubicm: number;
  maynilad_prev: number | null;
  maynilad_curr: number | null;
  total_active_units_camres: number | null;
  readings_approved: number;
  total_units: number;
  bills_generated: number;
  created_at: string;
}

function parseIsoDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addUtcMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

const CYCLE_META: Record<
  string,
  {
    label: string;
    actionLabel?: string;
    next?: string;
    buttonClass?: string;
    help: string;
  }
> = {
  draft: {
    label: 'Setup',
    actionLabel: 'Start Readings',
    next: 'reading_phase',
    buttonClass: 'bg-blue-600 text-white hover:bg-blue-700',
    help: 'Cycle details are set up, but field reading has not started yet.',
  },
  reading_phase: {
    label: 'Reading In Progress',
    actionLabel: 'Review Readings',
    next: 'review_phase',
    buttonClass: 'bg-yellow-600 text-white hover:bg-yellow-700',
    help: 'Readings are still being collected from the field or entered manually.',
  },
  review_phase: {
    label: 'Review Readings',
    actionLabel: 'Prepare Bills',
    next: 'billing',
    buttonClass: 'bg-purple-600 text-white hover:bg-purple-700',
    help: 'Staff are checking readings before bills are generated or rebuilt.',
  },
  billing: {
    label: 'Prepare Bills',
    actionLabel: 'Issue Bills',
    next: 'finalized',
    buttonClass: 'bg-green-600 text-white hover:bg-green-700',
    help: 'Bills can still be generated again from approved readings before release.',
  },
  finalized: {
    label: 'Bills Issued',
    actionLabel: 'Close Cycle',
    next: 'locked',
    buttonClass: 'bg-gray-600 text-white hover:bg-gray-700',
    help: 'Bills have been issued. The cycle should only be closed after final checks.',
  },
  locked: {
    label: 'Closed',
    help: 'The cycle is locked for audit and recordkeeping. No more rebuilding is allowed.',
  },
};

export function BillingCycleList() {
  const navigate = useNavigate();
  const { hasRole } = useAuthStore();
  const [cycles, setCycles] = useState<CycleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [form, setForm] = useState({
    period_start: '',
    period_end: '',
    rate_per_cubicm: '28.38',
    maynilad_prev: '',
    maynilad_curr: '',
    total_active_units_camres: '567',
  });
  const [creating, setCreating] = useState(false);

  const latestCycle = cycles[0] ?? null;

  const nextCycleDefaults = useMemo(() => {
    if (!latestCycle) {
      return {
        period_start: '',
        period_end: '',
        rate_per_cubicm: '28.38',
        maynilad_prev: '',
        maynilad_curr: '',
        total_active_units_camres: '',
      };
    }

    const nextStart = addUtcDays(parseIsoDate(latestCycle.period_end), 1);
    const nextEnd = addUtcDays(addUtcMonths(nextStart, 1), -1);

    return {
      period_start: formatIsoDate(nextStart),
      period_end: formatIsoDate(nextEnd),
      rate_per_cubicm: String(latestCycle.rate_per_cubicm),
      maynilad_prev:
        latestCycle.maynilad_curr != null ? String(latestCycle.maynilad_curr) : '',
      maynilad_curr: '',
      total_active_units_camres: String(latestCycle.total_units),
    };
  }, [latestCycle]);

  const canCreateNextCycle = !latestCycle || latestCycle.status === 'locked';

  const load = () => {
    setLoading(true);
    invoke<CycleRow[]>('list_billing_cycles')
      .then((rows) => setCycles(rows))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!showNew) {
      return;
    }

    setForm(nextCycleDefaults);
  }, [nextCycleDefaults, showNew]);

  const createCycle = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!canCreateNextCycle) {
      toast.error('Close the current billing cycle before creating the next one.');
      return;
    }

    if (!form.period_start || !form.period_end) {
      toast.error('The next billing period could not be prepared yet.');
      return;
    }

    setCreating(true);

    try {
      await invoke('create_billing_cycle', {
        payload: {
          period_start: form.period_start,
          period_end: form.period_end,
          rate_per_cubicm: parseFloat(form.rate_per_cubicm),
          maynilad_prev: form.maynilad_prev ? parseFloat(form.maynilad_prev) : null,
          maynilad_curr: form.maynilad_curr ? parseFloat(form.maynilad_curr) : null,
          total_active_units_camres: parseInt(form.total_active_units_camres, 10),
        },
      });

      toast.success('Billing cycle created. Pending readings were prepared for active units.');
      setShowNew(false);
      load();
    } catch (error) {
      toast.error(String(error));
    } finally {
      setCreating(false);
    }
  };

  const advance = async (cycle: CycleRow) => {
    const meta = CYCLE_META[cycle.status];
    if (!meta?.next) {
      return;
    }

    try {
      await invoke('update_billing_cycle_status', {
        payload: { cycle_id: cycle.id, status: meta.next },
      });
      toast.success(`Cycle moved to ${CYCLE_META[meta.next]?.label ?? meta.next}.`);
      load();
    } catch (error) {
      toast.error(String(error));
    }
  };

  const inputClass =
    'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  const columns: Column<CycleRow>[] = [
    {
      key: 'period',
      header: 'Billing Period',
      render: (cycle) => (
        <div>
          <p className="text-sm font-medium text-gray-800">
            {formatDate(cycle.period_start)} - {formatDate(cycle.period_end)}
          </p>
          <p className="text-xs text-gray-400">Created {formatDate(cycle.created_at)}</p>
        </div>
      ),
    },
    {
      key: 'rate',
      header: 'Rate',
      width: '110px',
      render: (cycle) => (
        <span className="font-mono text-xs text-gray-600">
          PHP {cycle.rate_per_cubicm}/m3
        </span>
      ),
    },
    {
      key: 'readings',
      header: 'Readings',
      width: '160px',
      render: (cycle) => (
        <div className="text-xs">
          <div className="font-medium text-gray-700">{cycle.readings_approved} approved</div>
          <div className="text-gray-400">{cycle.total_units} active units</div>
        </div>
      ),
    },
    {
      key: 'bills',
      header: 'Bills',
      width: '80px',
      render: (cycle) => <span className="text-sm font-medium">{cycle.bills_generated}</span>,
    },
    {
      key: 'status',
      header: 'Stage',
      width: '150px',
      render: (cycle) => (
        <div className="space-y-1">
          <StatusBadge
            status={cycle.status}
            label={CYCLE_META[cycle.status]?.label ?? cycle.status.replace(/_/g, ' ')}
          />
          <p className="text-[11px] text-gray-400">{CYCLE_META[cycle.status]?.help}</p>
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '260px',
      render: (cycle) => {
        const meta = CYCLE_META[cycle.status];
        const showBillsButton = ['review_phase', 'billing', 'finalized', 'locked'].includes(
          cycle.status,
        );

        return (
          <div className="flex justify-end gap-2" onClick={(event) => event.stopPropagation()}>
            {showBillsButton && hasRole('admin', 'billing_staff', 'cashier') && (
              <button
                onClick={() => navigate(`/billing/${cycle.id}/generate`)}
                className="rounded-lg border border-purple-200 bg-purple-50 px-2.5 py-1.5 text-xs text-purple-700 transition-colors hover:bg-purple-100"
              >
                Open Bills
              </button>
            )}
            {meta?.next && hasRole('admin') && (
              <button
                onClick={() => advance(cycle)}
                className={`rounded-lg px-2.5 py-1.5 text-xs transition-colors ${meta.buttonClass}`}
              >
                {meta.actionLabel}
              </button>
            )}
            <button
              onClick={() => navigate(`/billing/${cycle.id}/generate`)}
              className="p-1.5 text-gray-400 hover:text-gray-600"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <p className="text-sm text-gray-500">
            {cycles.length} billing cycle{cycles.length !== 1 ? 's' : ''}
          </p>
          <button
            onClick={() => setShowGuide(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100"
          >
            <HelpCircle size={14} />
            Cycle guide
          </button>
        </div>
        {hasRole('admin') && (
          <button
            onClick={() => setShowNew((value) => !value)}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white transition-colors hover:bg-blue-700"
          >
            <Plus size={14} />
            New Cycle
          </button>
        )}
      </div>

      {showNew && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="mb-4 text-sm font-semibold text-gray-800">New Billing Cycle</h3>
          <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
            <p className="text-sm font-medium text-blue-900">Cycle creation rule</p>
            <p className="mt-1 text-sm text-blue-900">
              Billing cycles can only be opened one month at a time and only after the current
              cycle is already closed.
            </p>
            {!canCreateNextCycle && latestCycle && (
              <p className="mt-2 text-xs text-blue-800">
                Close the current cycle for {formatDate(latestCycle.period_start)} -
                {' '}
                {formatDate(latestCycle.period_end)} before opening the next one.
              </p>
            )}
            <p className="mt-2 text-xs text-blue-800">
              The active-unit count is captured automatically for the cycle because it is used
              as the denominator for the CamRes-wide common system loss per unit.
            </p>
          </div>
          <form onSubmit={createCycle} className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600">Period Start *</label>
              <input type="date" value={form.period_start} readOnly disabled className={inputClass} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600">Period End *</label>
              <input type="date" value={form.period_end} readOnly disabled className={inputClass} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600">
                Rate per cu.m (PHP) *
              </label>
              <input
                type="number"
                step="0.01"
                value={form.rate_per_cubicm}
                onChange={(event) =>
                  setForm((current) => ({ ...current, rate_per_cubicm: event.target.value }))
                }
                required
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600">
                Active Units Snapshot (CamRes 3)
              </label>
              <input
                type="number"
                value={form.total_active_units_camres}
                readOnly
                disabled
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600">
                Maynilad Prev Reading (cu.m)
              </label>
              <input
                type="number"
                step="0.01"
                value={form.maynilad_prev}
                onChange={(event) =>
                  setForm((current) => ({ ...current, maynilad_prev: event.target.value }))
                }
                readOnly={latestCycle?.maynilad_curr != null}
                disabled={latestCycle?.maynilad_curr != null}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-600">
                Maynilad Curr Reading (cu.m)
              </label>
              <input
                type="number"
                step="0.01"
                value={form.maynilad_curr}
                onChange={(event) =>
                  setForm((current) => ({ ...current, maynilad_curr: event.target.value }))
                }
                className={inputClass}
              />
            </div>
            <div className="col-span-2 flex gap-3">
              <button
                type="button"
                onClick={() => setShowNew(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating || !canCreateNextCycle}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {creating ? 'Creating...' : 'Create Cycle'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm font-semibold text-blue-900">What Billing Cycles are for</p>
        <p className="mt-2 text-sm text-blue-900">
          Billing owns the monthly cycle: stage readings, maintain loss inputs, generate or rebuild
          bills, batch print statements, issue them, and close the month. Cash collections are
          posted only from Payment Queue, not from the Billing screens. Actual disconnection and
          reconnection work is tracked separately in Service Cases.
        </p>
      </div>

      <DataTable
        columns={columns}
        data={cycles}
        rowKey={(cycle) => cycle.id}
        loading={loading}
        onRowClick={(cycle) => navigate(`/billing/${cycle.id}/generate`)}
        emptyMessage="No billing cycles yet. Create one to get started."
      />

      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowGuide(false)} />
          <div className="relative mx-4 w-full max-w-4xl rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Billing cycle guide</h3>
                <p className="mt-1 text-sm text-gray-500">
                  This explains what each billing stage means and when it should be used.
                </p>
              </div>
              <button
                onClick={() => setShowGuide(false)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {Object.entries(CYCLE_META).map(([status, meta]) => (
                <div key={status} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <StatusBadge status={status} label={meta.label} />
                  <p className="mt-2 text-sm text-gray-600">{meta.help}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
