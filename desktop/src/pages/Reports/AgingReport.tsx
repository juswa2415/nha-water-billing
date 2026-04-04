import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import toast from 'react-hot-toast';
import { DataTable, type Column } from '../../components/shared/DataTable';
import { php } from '../../utils/formatters';

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

export function AgingReport() {
  const [data, setData] = useState<AgingRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData([]);

    invoke<AgingRow[]>('aging_report')
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
  }, []);

  const totals = useMemo(
    () =>
      data.reduce(
        (accumulator, row) => ({
          current: accumulator.current + row.current_balance,
          d30: accumulator.d30 + row.overdue_30,
          d60: accumulator.d60 + row.overdue_60,
          d90: accumulator.d90 + row.overdue_90_plus,
          total: accumulator.total + row.total_outstanding,
        }),
        { current: 0, d30: 0, d60: 0, d90: 0, total: 0 },
      ),
    [data],
  );

  const columns: Column<AgingRow>[] = [
    {
      key: 'unit',
      header: 'Unit',
      width: '110px',
      render: (row) => (
        <span className="font-mono text-xs font-medium">
          {row.building_code}-{row.unit_number}
        </span>
      ),
    },
    {
      key: 'name',
      header: 'Resident',
      render: (row) => <span className="text-xs">{row.resident_name}</span>,
    },
    {
      key: 'current',
      header: 'Current (<=30d)',
      render: (row) =>
        row.current_balance > 0 ? (
          <span className="text-xs text-gray-700">{php(row.current_balance)}</span>
        ) : (
          <span className="text-xs text-gray-300">-</span>
        ),
    },
    {
      key: 'd30',
      header: '31-60 days',
      render: (row) =>
        row.overdue_30 > 0 ? (
          <span className="text-xs text-yellow-700">{php(row.overdue_30)}</span>
        ) : (
          <span className="text-xs text-gray-300">-</span>
        ),
    },
    {
      key: 'd60',
      header: '61-90 days',
      render: (row) =>
        row.overdue_60 > 0 ? (
          <span className="text-xs text-orange-700">{php(row.overdue_60)}</span>
        ) : (
          <span className="text-xs text-gray-300">-</span>
        ),
    },
    {
      key: 'd90',
      header: '90+ days',
      render: (row) =>
        row.overdue_90_plus > 0 ? (
          <span className="text-xs font-medium text-red-700">{php(row.overdue_90_plus)}</span>
        ) : (
          <span className="text-xs text-gray-300">-</span>
        ),
    },
    {
      key: 'total',
      header: 'Total Outstanding',
      render: (row) => (
        <span className="text-sm font-semibold text-red-600">{php(row.total_outstanding)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm font-semibold text-blue-900">What aging means</p>
        <p className="mt-2 text-sm text-blue-900">
          This report groups unpaid balances by how long they have been overdue. It helps
          the admin see which accounts are still current and which ones are becoming high-risk
          for collection follow-up.
        </p>
      </div>

      {data.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          {[
            { label: 'Current (<=30d)', value: totals.current, color: 'bg-gray-50 text-gray-700' },
            { label: '31-60 days', value: totals.d30, color: 'bg-yellow-50 text-yellow-800' },
            { label: '61-90 days', value: totals.d60, color: 'bg-orange-50 text-orange-800' },
            { label: '90+ days', value: totals.d90, color: 'bg-red-50 text-red-800' },
          ].map((summary) => (
            <div key={summary.label} className={`rounded-xl border p-4 ${summary.color}`}>
              <p className="mb-1 text-xs font-medium">{summary.label}</p>
              <p className="text-lg font-semibold">{php(summary.value)}</p>
            </div>
          ))}
        </div>
      )}

      <DataTable
        columns={columns}
        data={data}
        rowKey={(row) => `${row.building_code}-${row.unit_number}`}
        loading={loading}
        emptyMessage="No outstanding balances."
      />
    </div>
  );
}
