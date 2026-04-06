import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Building2,
  CreditCard,
  FileText,
  Gauge,
  Receipt,
  TrendingUp,
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { StatusBadge } from '../components/shared/StatusBadge';
import { formatDate, php } from '../utils/formatters';

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

interface BuildingDirectoryRow {
  id: number;
  code: string;
  name: string;
  active_units: number;
}

interface SummaryRow {
  building_code: string;
  total_bills: number;
  total_amount_due: number;
  total_collected: number;
  total_outstanding: number;
  fully_paid: number;
  partially_paid: number;
  unpaid: number;
}

interface CollectionRow {
  payment_id: number;
  payment_date: string;
  receipt_number: string;
  unit_number: string;
  building_code: string;
  resident_name: string;
  amount_paid: number;
  received_by: string;
  payment_method: string;
}

interface AgingRow {
  unit_number: string;
  building_code: string;
  resident_name: string;
  current_balance: number;
  overdue_30: number;
  overdue_60: number;
  overdue_90_plus: number;
  total_outstanding: number;
}

export function Dashboard() {
  const { user, hasRole } = useAuthStore();
  const navigate = useNavigate();
  const [cycles, setCycles] = useState<CycleRow[]>([]);
  const [buildings, setBuildings] = useState<BuildingDirectoryRow[]>([]);
  const [buildingSummary, setBuildingSummary] = useState<SummaryRow[]>([]);
  const [collections, setCollections] = useState<CollectionRow[]>([]);
  const [aging, setAging] = useState<AgingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [cycleLoading, setCycleLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([
      invoke<CycleRow[]>('list_billing_cycles'),
      invoke<BuildingDirectoryRow[]>('list_buildings'),
      invoke<AgingRow[]>('aging_report'),
    ])
      .then(([cycleRows, buildingRows, agingRows]) => {
        if (cancelled) {
          return;
        }
        setCycles(cycleRows.slice(0, 5));
        setBuildings(buildingRows);
        setAging(agingRows);
      })
      .catch(error => {
        if (!cancelled) {
          toast.error(String(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const latestCycle = cycles[0];

  useEffect(() => {
    if (!latestCycle?.id) {
      setBuildingSummary([]);
      setCollections([]);
      return;
    }

    let cancelled = false;
    setCycleLoading(true);

    Promise.all([
      invoke<SummaryRow[]>('billing_summary', { cycleId: latestCycle.id }),
      invoke<CollectionRow[]>('collection_summary', { cycleId: latestCycle.id }),
    ])
      .then(([summaryRows, collectionRows]) => {
        if (cancelled) {
          return;
        }
        setBuildingSummary(summaryRows);
        setCollections(collectionRows);
      })
      .catch(error => {
        if (!cancelled) {
          setBuildingSummary([]);
          setCollections([]);
          toast.error(String(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCycleLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [latestCycle?.id]);

  const firstName = user?.full_name.split(' ')[0] ?? 'there';
  const isCashier = user?.role === 'cashier';

  const activeUnits = useMemo(
    () => buildings.reduce((sum, building) => sum + building.active_units, 0),
    [buildings],
  );

  const cycleTotals = useMemo(
    () =>
      buildingSummary.reduce(
        (accumulator, row) => ({
          billed: accumulator.billed + row.total_amount_due,
          collected: accumulator.collected + row.total_collected,
          outstanding: accumulator.outstanding + row.total_outstanding,
          paid: accumulator.paid + row.fully_paid,
          partial: accumulator.partial + row.partially_paid,
          unpaid: accumulator.unpaid + row.unpaid,
          bills: accumulator.bills + row.total_bills,
        }),
        {
          billed: 0,
          collected: 0,
          outstanding: 0,
          paid: 0,
          partial: 0,
          unpaid: 0,
          bills: 0,
        },
      ),
    [buildingSummary],
  );

  const agingTotals = useMemo(
    () =>
      aging.reduce(
        (accumulator, row) => ({
          current: accumulator.current + row.current_balance,
          overdue30: accumulator.overdue30 + row.overdue_30,
          overdue60: accumulator.overdue60 + row.overdue_60,
          overdue90: accumulator.overdue90 + row.overdue_90_plus,
          total: accumulator.total + row.total_outstanding,
        }),
        {
          current: 0,
          overdue30: 0,
          overdue60: 0,
          overdue90: 0,
          total: 0,
        },
      ),
    [aging],
  );

  const topOutstandingBuildings = useMemo(
    () =>
      [...buildingSummary]
        .filter(row => row.total_outstanding > 0)
        .sort((left, right) => right.total_outstanding - left.total_outstanding)
        .slice(0, 5),
    [buildingSummary],
  );

  const topAgingAccounts = useMemo(() => aging.slice(0, 5), [aging]);

  const todayCollected = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return collections
      .filter(row => row.payment_date.slice(0, 10) === today)
      .reduce((sum, row) => sum + row.amount_paid, 0);
  }, [collections]);

  const entryProgress = latestCycle?.total_units
    ? Math.round((latestCycle.readings_submitted / latestCycle.total_units) * 100)
    : 0;
  const approvalProgress = latestCycle?.total_units
    ? Math.round((latestCycle.readings_approved / latestCycle.total_units) * 100)
    : 0;
  const billingProgress = latestCycle?.total_units
    ? Math.round((latestCycle.bills_generated / latestCycle.total_units) * 100)
    : 0;

  const queueCount = cycleTotals.partial + cycleTotals.unpaid;

  const quickActions = [
    {
      label: isCashier ? 'Open Payment Queue' : 'Review Readings',
      description: isCashier ? 'Start posting cash payments.' : 'Continue encoding and approvals.',
      to: isCashier ? '/payments/queue' : '/readings',
      icon: isCashier ? <CreditCard size={16} /> : <Gauge size={16} />,
      color: isCashier
        ? 'border-green-200 bg-green-50 text-green-700'
        : 'border-blue-200 bg-blue-50 text-blue-700',
    },
    {
      label: 'Receipt Log',
      description: 'Open posted receipts and recent collections.',
      to: '/reports/collection',
      icon: <Receipt size={16} />,
      color: 'border-gray-200 bg-white text-gray-700',
    },
    ...(!isCashier
      ? [
          {
            label: 'Billing Cycles',
            description: 'Manage the current billing period.',
            to: '/billing',
            icon: <FileText size={16} />,
            color: 'border-amber-200 bg-amber-50 text-amber-700',
          },
          {
            label: 'Payment Queue',
            description: 'Review unpaid and partial bills.',
            to: '/payments/queue',
            icon: <Banknote size={16} />,
            color: 'border-emerald-200 bg-emerald-50 text-emerald-700',
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6 max-w-7xl">
      <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
              {isCashier ? 'Cashier console' : 'Operations dashboard'}
            </div>
            <div>
              <h2 className="text-3xl font-semibold text-gray-900">
                Good {new Date().getHours() < 12 ? 'morning' : 'afternoon'}, {firstName}
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                {isCashier
                  ? 'Your first stop should be the payment queue, then receipt reprints if needed.'
                  : 'Track cycle progress, collection health, and accounts needing attention in one place.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {quickActions.slice(0, 2).map(action => (
              <button
                key={action.to}
                onClick={() => navigate(action.to)}
                className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-colors hover:opacity-90 ${action.color}`}
              >
                {action.icon}
                {action.label}
              </button>
            ))}
          </div>
        </div>

        {latestCycle ? (
          <div className="mt-5 grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Latest billing cycle</p>
                  <p className="mt-1 text-sm text-gray-600">
                    {formatDate(latestCycle.period_start)} - {formatDate(latestCycle.period_end)}
                  </p>
                </div>
                <StatusBadge status={latestCycle.status} />
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <ProgressLine
                  label="Readings entered"
                  value={`${latestCycle.readings_submitted}/${latestCycle.total_units}`}
                  progress={entryProgress}
                  tone="blue"
                />
                <ProgressLine
                  label="Readings approved"
                  value={`${latestCycle.readings_approved}/${latestCycle.total_units}`}
                  progress={approvalProgress}
                  tone="emerald"
                />
                <ProgressLine
                  label="Bills generated"
                  value={`${latestCycle.bills_generated}/${latestCycle.total_units}`}
                  progress={billingProgress}
                  tone="amber"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <p className="text-sm font-semibold text-gray-900">Today</p>
              <div className="mt-4 space-y-3">
                <MiniMetric label="Payments posted today" value={php(todayCollected)} />
                <MiniMetric label="Accounts in queue" value={String(queueCount)} />
                <MiniMetric label="Portfolio aging exposure" value={php(agingTotals.total)} />
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-6 text-sm text-gray-500">
            No billing cycle has been created yet.
          </div>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <StatCard
          label="Buildings"
          value={String(buildings.length)}
          helper="Live directory"
          icon={<Building2 size={16} />}
          tone="blue"
        />
        <StatCard
          label="Active units"
          value={String(activeUnits)}
          helper="Current portfolio"
          icon={<TrendingUp size={16} />}
          tone="emerald"
        />
        <StatCard
          label="Cycle billed"
          value={php(cycleTotals.billed)}
          helper={`${cycleTotals.bills} bills in latest cycle`}
          icon={<FileText size={16} />}
          tone="amber"
        />
        <StatCard
          label="Cycle collected"
          value={php(cycleTotals.collected)}
          helper={
            cycleTotals.billed > 0
              ? `${Math.round((cycleTotals.collected / cycleTotals.billed) * 100)}% collection rate`
              : 'No billed amount yet'
          }
          icon={<Banknote size={16} />}
          tone="emerald"
        />
        <StatCard
          label="Outstanding"
          value={php(cycleTotals.outstanding)}
          helper={`${queueCount} partial or unpaid accounts`}
          icon={<AlertTriangle size={16} />}
          tone="red"
        />
        <StatCard
          label="Needs approval"
          value={String(Math.max((latestCycle?.readings_submitted ?? 0) - (latestCycle?.readings_approved ?? 0), 0))}
          helper="Submitted readings pending review"
          icon={<Gauge size={16} />}
          tone="purple"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <DashboardPanel
          title="Buildings to watch"
          subtitle="Outstanding balances by building in the latest cycle."
          loading={cycleLoading}
        >
          {topOutstandingBuildings.length === 0 ? (
            <EmptyPanel message="No buildings have outstanding balances in the latest cycle." />
          ) : (
            <div className="space-y-4">
              {topOutstandingBuildings.map(row => (
                <div key={row.building_code} className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{row.building_code}</p>
                      <p className="text-xs text-gray-500">
                        {row.total_bills} bills, {row.unpaid + row.partially_paid} accounts still open
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-red-600">
                        {php(row.total_outstanding)}
                      </p>
                      <p className="text-xs text-gray-500">
                        {php(row.total_collected)} collected / {php(row.total_amount_due)} billed
                      </p>
                    </div>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-red-400"
                      style={{
                        width: `${
                          row.total_amount_due > 0
                            ? Math.min((row.total_outstanding / row.total_amount_due) * 100, 100)
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </DashboardPanel>

        <DashboardPanel
          title="Recent payments"
          subtitle="Most recent posted receipts from the latest cycle."
          loading={cycleLoading}
        >
          {collections.length === 0 ? (
            <EmptyPanel message="No payments have been posted in the latest cycle yet." />
          ) : (
            <div className="space-y-3">
              {collections.slice(0, 5).map(row => (
                <button
                  key={row.payment_id}
                  type="button"
                  onClick={() => navigate(`/payments/receipt/${row.payment_id}`)}
                  className="flex w-full items-center justify-between rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-left transition-colors hover:bg-gray-100"
                >
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{row.receipt_number}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {row.building_code}-{row.unit_number} | {row.resident_name}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-green-700">{php(row.amount_paid)}</p>
                    <p className="mt-1 text-xs text-gray-500">{formatDate(row.payment_date)}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </DashboardPanel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <DashboardPanel
          title="Aging exposure"
          subtitle="Open balances across the whole portfolio, regardless of cycle."
          loading={loading}
        >
          {aging.length === 0 ? (
            <EmptyPanel message="No overdue balances found." />
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <RiskTile label="Current" value={php(agingTotals.current)} />
                <RiskTile label="31-60 days" value={php(agingTotals.overdue30)} />
                <RiskTile label="61-90 days" value={php(agingTotals.overdue60)} />
                <RiskTile label="90+ days" value={php(agingTotals.overdue90)} tone="red" />
              </div>

              <div className="space-y-3">
                {topAgingAccounts.map(row => (
                  <div
                    key={`${row.building_code}-${row.unit_number}`}
                    className="flex items-center justify-between rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        {row.building_code}-{row.unit_number}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">{row.resident_name}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-red-600">
                        {php(row.total_outstanding)}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        {php(row.overdue_90_plus)} in 90+ bucket
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DashboardPanel>

        <DashboardPanel
          title="Action lanes"
          subtitle="The next screens users actually need during daily operations."
          loading={false}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {quickActions.map(action => (
              <button
                key={action.to}
                onClick={() => navigate(action.to)}
                className={`rounded-2xl border px-4 py-4 text-left transition-colors hover:opacity-90 ${action.color}`}
              >
                <div className="flex items-center gap-2">
                  {action.icon}
                  <span className="text-sm font-semibold">{action.label}</span>
                </div>
                <p className="mt-2 text-xs opacity-80">{action.description}</p>
              </button>
            ))}
          </div>

          <div className="mt-4 rounded-2xl border border-gray-100 bg-gray-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">Recent cycles</p>
                <p className="mt-1 text-xs text-gray-500">
                  Quick context on the last few billing periods.
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/billing')}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                View all
                <ArrowRight size={13} />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {cycles.map(cycle => (
                <button
                  key={cycle.id}
                  type="button"
                  onClick={() => navigate('/billing')}
                  className="flex w-full items-center justify-between rounded-xl border border-white bg-white px-3 py-3 text-left transition-colors hover:bg-gray-50"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-800">
                      {formatDate(cycle.period_start)} - {formatDate(cycle.period_end)}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {cycle.readings_approved} approved | {cycle.bills_generated} billed
                    </p>
                  </div>
                  <StatusBadge status={cycle.status} />
                </button>
              ))}
            </div>
          </div>
        </DashboardPanel>
      </section>
    </div>
  );
}

function DashboardPanel({
  title,
  subtitle,
  loading,
  children,
}: {
  title: string;
  subtitle: string;
  loading: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
      </div>

      <div className="mt-5">
        {loading ? <div className="py-12 text-center text-sm text-gray-400">Loading...</div> : children}
      </div>
    </section>
  );
}

function StatCard({
  label,
  value,
  helper,
  icon,
  tone,
}: {
  label: string;
  value: string;
  helper: string;
  icon: React.ReactNode;
  tone: 'blue' | 'emerald' | 'amber' | 'red' | 'purple';
}) {
  const toneClasses = {
    blue: 'bg-blue-50 text-blue-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
    purple: 'bg-purple-50 text-purple-700',
  }[tone];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</span>
        <div className={`rounded-xl p-2 ${toneClasses}`}>{icon}</div>
      </div>
      <p className="mt-4 text-3xl font-semibold text-gray-900">{value}</p>
      <p className="mt-2 text-xs text-gray-500">{helper}</p>
    </div>
  );
}

function ProgressLine({
  label,
  value,
  progress,
  tone,
}: {
  label: string;
  value: string;
  progress: number;
  tone: 'blue' | 'emerald' | 'amber';
}) {
  const barColor = {
    blue: 'bg-blue-500',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
  }[tone];

  return (
    <div className="rounded-2xl border border-white bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
        <p className="text-sm font-semibold text-gray-900">{value}</p>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${progress}%` }} />
      </div>
      <p className="mt-2 text-xs text-gray-500">{progress}% complete</p>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white bg-white px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function RiskTile({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'red';
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        tone === 'red'
          ? 'border-red-100 bg-red-50 text-red-700'
          : 'border-gray-100 bg-gray-50 text-gray-700'
      }`}
    >
      <p className="text-xs uppercase tracking-wide text-current/80">{label}</p>
      <p className="mt-2 text-xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-6 text-sm text-gray-500">{message}</div>;
}
