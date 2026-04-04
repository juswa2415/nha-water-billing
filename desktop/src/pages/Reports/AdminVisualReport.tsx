import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import toast from 'react-hot-toast';
import { ChevronDown } from 'lucide-react';
import { formatDate, php } from '../../utils/formatters';

interface CycleOption {
  id: number;
  period_start: string;
  period_end: string;
}

interface BillingSummaryRow {
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

function MetricCard({
  label,
  value,
  note,
  loading = false,
}: {
  label: string;
  value: string;
  note: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      {loading ? (
        <div className="mt-4 text-sm text-gray-400">Loading...</div>
      ) : (
        <>
          <p className="mt-2 text-2xl font-semibold text-gray-900">{value}</p>
          <p className="mt-1 text-xs text-gray-500">{note}</p>
        </>
      )}
    </div>
  );
}

export function AdminVisualReport() {
  const [cycles, setCycles] = useState<CycleOption[]>([]);
  const [cycleId, setCycleId] = useState<number | null>(null);
  const [billingRows, setBillingRows] = useState<BillingSummaryRow[]>([]);
  const [collectionRows, setCollectionRows] = useState<CollectionRow[]>([]);
  const [agingRows, setAgingRows] = useState<AgingRow[]>([]);
  const [loadingCycleData, setLoadingCycleData] = useState(false);
  const [loadingAging, setLoadingAging] = useState(true);

  useEffect(() => {
    let cancelled = false;

    invoke<CycleOption[]>('list_billing_cycles')
      .then((rows) => {
        if (cancelled) {
          return;
        }
        setCycles(rows);
        if (rows.length > 0) {
          setCycleId(rows[0].id);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(String(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingAging(true);

    invoke<AgingRow[]>('aging_report')
      .then((rows) => {
        if (!cancelled) {
          setAgingRows(rows);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(String(error));
          setAgingRows([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingAging(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!cycleId) {
      return;
    }

    let cancelled = false;
    setLoadingCycleData(true);
    setBillingRows([]);
    setCollectionRows([]);

    Promise.all([
      invoke<BillingSummaryRow[]>('billing_summary', { cycleId }),
      invoke<CollectionRow[]>('collection_summary', { cycleId }),
    ])
      .then(([billingData, collectionData]) => {
        if (cancelled) {
          return;
        }
        setBillingRows(billingData);
        setCollectionRows(collectionData);
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(String(error));
          setBillingRows([]);
          setCollectionRows([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingCycleData(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cycleId]);

  const billingTotals = useMemo(
    () =>
      billingRows.reduce(
        (accumulator, row) => ({
          totalBills: accumulator.totalBills + row.total_bills,
          totalDue: accumulator.totalDue + row.total_amount_due,
          totalCollected: accumulator.totalCollected + row.total_collected,
          totalOutstanding: accumulator.totalOutstanding + row.total_outstanding,
          fullyPaid: accumulator.fullyPaid + row.fully_paid,
          partiallyPaid: accumulator.partiallyPaid + row.partially_paid,
          unpaid: accumulator.unpaid + row.unpaid,
        }),
        {
          totalBills: 0,
          totalDue: 0,
          totalCollected: 0,
          totalOutstanding: 0,
          fullyPaid: 0,
          partiallyPaid: 0,
          unpaid: 0,
        },
      ),
    [billingRows],
  );

  const collectionRate =
    billingTotals.totalDue > 0
      ? (billingTotals.totalCollected / billingTotals.totalDue) * 100
      : 0;

  const buildingMax = Math.max(
    1,
    ...billingRows.map((row) =>
      Math.max(row.total_amount_due, row.total_collected, row.total_outstanding),
    ),
  );

  const dailyCollections = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const row of collectionRows) {
      grouped.set(row.payment_date, (grouped.get(row.payment_date) ?? 0) + row.amount_paid);
    }

    return Array.from(grouped.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(-10)
      .map(([date, amount]) => ({ date, amount }));
  }, [collectionRows]);

  const dailyMax = Math.max(1, ...dailyCollections.map((row) => row.amount));

  const agingTotals = useMemo(
    () =>
      agingRows.reduce(
        (accumulator, row) => ({
          current: accumulator.current + row.current_balance,
          d30: accumulator.d30 + row.overdue_30,
          d60: accumulator.d60 + row.overdue_60,
          d90: accumulator.d90 + row.overdue_90_plus,
          total: accumulator.total + row.total_outstanding,
        }),
        { current: 0, d30: 0, d60: 0, d90: 0, total: 0 },
      ),
    [agingRows],
  );

  const statusTotal = Math.max(
    1,
    billingTotals.fullyPaid + billingTotals.partiallyPaid + billingTotals.unpaid,
  );

  const topDelinquents = [...agingRows]
    .sort((left, right) => right.total_outstanding - left.total_outstanding)
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
        <p className="text-sm font-semibold text-blue-900">Admin visual overview</p>
        <p className="mt-2 text-sm text-blue-900">
          This page is meant for the admin only. It turns billing, collection, and delinquency
          data into quick visual summaries for decision-making.
        </p>
        <p className="mt-2 text-xs text-blue-800">
          Good admin visuals should answer: how much was billed, how much came in, where the
          weak collection spots are, and which accounts are aging into risk.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative">
          <select
            value={cycleId ?? ''}
            onChange={(event) => setCycleId(Number(event.target.value))}
            className="appearance-none rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {cycles.map((cycle) => (
              <option key={cycle.id} value={cycle.id}>
                {cycle.period_start} - {cycle.period_end}
              </option>
            ))}
          </select>
          <ChevronDown
            size={13}
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400"
          />
        </div>
        <span className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600">
          Cycle-level billing and collection with portfolio-wide aging
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Total Billed"
          value={php(billingTotals.totalDue)}
          note={`${billingTotals.totalBills} bills in selected cycle`}
          loading={loadingCycleData}
        />
        <MetricCard
          label="Collected"
          value={php(billingTotals.totalCollected)}
          note={`${collectionRate.toFixed(1)}% collection rate`}
          loading={loadingCycleData}
        />
        <MetricCard
          label="Outstanding"
          value={php(billingTotals.totalOutstanding)}
          note={`${billingTotals.unpaid} unpaid and ${billingTotals.partiallyPaid} partial accounts`}
          loading={loadingCycleData}
        />
        <MetricCard
          label="Aging Exposure"
          value={php(agingTotals.total)}
          note="Total overdue exposure across the portfolio"
          loading={loadingAging}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <div className="self-start rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900">Collection by building</h3>
          <p className="mt-1 text-xs text-gray-500">
            Compare billed, collected, and outstanding amounts per building.
          </p>

          <div className="mt-4 space-y-4">
            {loadingCycleData ? (
              <div className="py-10 text-center text-sm text-gray-400">Loading...</div>
            ) : billingRows.length === 0 ? (
              <div className="py-10 text-center text-sm text-gray-400">
                No billing data for the selected cycle.
              </div>
            ) : (
              billingRows.map((row) => (
                <div key={row.building_code} className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono font-medium text-gray-800">{row.building_code}</span>
                    <span className="text-gray-500">
                      {php(row.total_collected)} collected / {php(row.total_amount_due)} billed
                    </span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full bg-blue-200"
                      style={{ width: `${(row.total_amount_due / buildingMax) * 100}%` }}
                    />
                    <div
                      className="-mt-3 h-full bg-green-500"
                      style={{ width: `${(row.total_collected / buildingMax) * 100}%` }}
                    />
                  </div>
                  <div className="text-xs text-red-500">
                    Outstanding {php(row.total_outstanding)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="self-start rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900">Payment status mix</h3>
          <p className="mt-1 text-xs text-gray-500">
            Fast view of which bills are settled, partially settled, or still unpaid.
          </p>

          <div className="mt-5">
            {loadingCycleData ? (
              <div className="py-12 text-center text-sm text-gray-400">Loading...</div>
            ) : (
              <>
                <div className="flex h-6 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="bg-green-500"
                    style={{ width: `${(billingTotals.fullyPaid / statusTotal) * 100}%` }}
                  />
                  <div
                    className="bg-yellow-400"
                    style={{ width: `${(billingTotals.partiallyPaid / statusTotal) * 100}%` }}
                  />
                  <div
                    className="bg-red-400"
                    style={{ width: `${(billingTotals.unpaid / statusTotal) * 100}%` }}
                  />
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3">
                  <div className="rounded-xl bg-green-50 p-3 text-green-800">
                    <p className="text-xs font-medium">Settled</p>
                    <p className="mt-1 text-lg font-semibold">{billingTotals.fullyPaid}</p>
                  </div>
                  <div className="rounded-xl bg-yellow-50 p-3 text-yellow-800">
                    <p className="text-xs font-medium">Partial</p>
                    <p className="mt-1 text-lg font-semibold">{billingTotals.partiallyPaid}</p>
                  </div>
                  <div className="rounded-xl bg-red-50 p-3 text-red-800">
                    <p className="text-xs font-medium">Unpaid</p>
                    <p className="mt-1 text-lg font-semibold">{billingTotals.unpaid}</p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <div className="self-start rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900">Daily collection trend</h3>
          <p className="mt-1 text-xs text-gray-500">
            Recent payment days for the selected cycle.
          </p>

          <div className="mt-5 flex min-h-[220px] items-end gap-3">
            {loadingCycleData ? (
              <div className="w-full py-10 text-center text-sm text-gray-400">Loading...</div>
            ) : dailyCollections.length === 0 ? (
              <div className="w-full py-10 text-center text-sm text-gray-400">
                No posted payments for the selected cycle.
              </div>
            ) : (
              dailyCollections.map((row) => (
                <div key={row.date} className="flex flex-1 flex-col items-center gap-2">
                  <div className="text-[11px] font-medium text-gray-500">{php(row.amount)}</div>
                  <div className="flex h-40 w-full items-end rounded-t-xl bg-gray-100 px-2">
                    <div
                      className="w-full rounded-t-lg bg-blue-500"
                      style={{ height: `${Math.max(10, (row.amount / dailyMax) * 100)}%` }}
                    />
                  </div>
                  <div className="text-center text-[11px] text-gray-500">
                    {formatDate(row.date)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="self-start rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900">Aging exposure</h3>
          <p className="mt-1 text-xs text-gray-500">
            Overdue balances grouped by age bucket across all open receivables.
          </p>

          <div className="mt-5 space-y-4">
            {loadingAging ? (
              <div className="py-10 text-center text-sm text-gray-400">Loading...</div>
            ) : (
              [
                { label: 'Current (<=30d)', value: agingTotals.current, color: 'bg-gray-500' },
                { label: '31-60 days', value: agingTotals.d30, color: 'bg-yellow-500' },
                { label: '61-90 days', value: agingTotals.d60, color: 'bg-orange-500' },
                { label: '90+ days', value: agingTotals.d90, color: 'bg-red-500' },
              ].map((bucket) => {
                const ratio = agingTotals.total > 0 ? (bucket.value / agingTotals.total) * 100 : 0;
                return (
                  <div key={bucket.label} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-700">{bucket.label}</span>
                      <span className="font-medium text-gray-900">{php(bucket.value)}</span>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className={`h-full ${bucket.color}`}
                        style={{ width: `${Math.max(ratio, bucket.value > 0 ? 4 : 0)}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900">Top overdue accounts</h3>
        <p className="mt-1 text-xs text-gray-500">
          Accounts with the highest outstanding balances right now.
        </p>

        <div className="mt-4 space-y-3">
          {loadingAging ? (
            <div className="py-10 text-center text-sm text-gray-400">Loading...</div>
          ) : topDelinquents.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">
              No overdue accounts found.
            </div>
          ) : (
            topDelinquents.map((row, index) => (
              <div
                key={`${row.building_code}-${row.unit_number}`}
                className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    #{index + 1} {row.resident_name}
                  </p>
                  <p className="font-mono text-xs text-gray-500">
                    {row.building_code}-{row.unit_number}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-red-600">
                    {php(row.total_outstanding)}
                  </p>
                  <p className="text-xs text-gray-500">
                    Current {php(row.current_balance)} | 90+ {php(row.overdue_90_plus)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
