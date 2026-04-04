import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import toast from 'react-hot-toast';
import { ChevronDown } from 'lucide-react';
import { DataTable, type Column } from '../../components/shared/DataTable';
import { php } from '../../utils/formatters';

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

interface CycleOption {
  id: number;
  period_start: string;
  period_end: string;
}

export function BillingSummary() {
  const [cycles, setCycles] = useState<CycleOption[]>([]);
  const [cycleId, setCycleId] = useState<number | null>(null);
  const [data, setData] = useState<SummaryRow[]>([]);
  const [loading, setLoading] = useState(false);

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
    if (!cycleId) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setData([]);

    invoke<SummaryRow[]>('billing_summary', { cycleId })
      .then((rows) => {
        if (!cancelled) {
          setData(rows);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setData([]);
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
  }, [cycleId]);

  const totals = useMemo(
    () =>
      data.reduce(
        (accumulator, row) => ({
          total_bills: accumulator.total_bills + row.total_bills,
          total_amount_due: accumulator.total_amount_due + row.total_amount_due,
          total_collected: accumulator.total_collected + row.total_collected,
          total_outstanding: accumulator.total_outstanding + row.total_outstanding,
          fully_paid: accumulator.fully_paid + row.fully_paid,
          partially_paid: accumulator.partially_paid + row.partially_paid,
          unpaid: accumulator.unpaid + row.unpaid,
        }),
        {
          total_bills: 0,
          total_amount_due: 0,
          total_collected: 0,
          total_outstanding: 0,
          fully_paid: 0,
          partially_paid: 0,
          unpaid: 0,
        },
      ),
    [data],
  );

  const columns: Column<SummaryRow>[] = [
    {
      key: 'building',
      header: 'Building',
      width: '110px',
      render: (row) => (
        <span className="font-mono text-sm font-medium text-gray-800">{row.building_code}</span>
      ),
    },
    {
      key: 'bills',
      header: 'Bills',
      width: '70px',
      render: (row) => row.total_bills,
    },
    {
      key: 'due',
      header: 'Total Due',
      render: (row) => php(row.total_amount_due),
    },
    {
      key: 'collected',
      header: 'Collected',
      render: (row) => <span className="text-green-700">{php(row.total_collected)}</span>,
    },
    {
      key: 'outstanding',
      header: 'Outstanding',
      render: (row) =>
        row.total_outstanding > 0 ? (
          <span className="font-medium text-red-600">{php(row.total_outstanding)}</span>
        ) : (
          <span className="text-gray-300">-</span>
        ),
    },
    {
      key: 'paid',
      header: 'Fully Paid',
      width: '90px',
      render: (row) => <span className="text-green-700">{row.fully_paid}</span>,
    },
    {
      key: 'partial',
      header: 'Partial',
      width: '70px',
      render: (row) => row.partially_paid,
    },
    {
      key: 'unpaid',
      header: 'Unpaid',
      width: '70px',
      render: (row) =>
        row.unpaid > 0 ? (
          <span className="font-medium text-red-600">{row.unpaid}</span>
        ) : (
          <span className="text-gray-300">0</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm font-semibold text-blue-900">What this report is for</p>
        <p className="mt-2 text-sm text-blue-900">
          This summarizes one billing cycle by building: how much was billed, how much was
          collected, and how much is still outstanding.
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

        {data.length > 0 && (
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="rounded-full bg-gray-100 px-3 py-1.5 text-gray-700">
              {totals.total_bills} bills
            </span>
            <span className="rounded-full border border-green-200 bg-green-50 px-3 py-1.5 text-green-700">
              Collected {php(totals.total_collected)}
            </span>
            <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-red-700">
              Outstanding {php(totals.total_outstanding)}
            </span>
          </div>
        )}
      </div>

      <DataTable
        columns={columns}
        data={data}
        rowKey={(row) => row.building_code}
        loading={loading}
        emptyMessage="No billing summary available for the selected cycle."
      />
    </div>
  );
}
