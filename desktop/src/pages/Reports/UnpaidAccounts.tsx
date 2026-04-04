// src/pages/Reports/UnpaidAccounts.tsx
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate } from 'react-router-dom';
import { DataTable, Column } from '../../components/shared/DataTable';
import { php, formatDate } from '../../utils/formatters';
import { ChevronDown, CreditCard } from 'lucide-react';
import toast from 'react-hot-toast';

interface UnpaidRow {
  unit_number: string; building_code: string; resident_name: string;
  account_number: string; total_amount_due: number;
  outstanding_balance: number; due_date: string | null;
}
interface CycleOption { id: number; period_start: string; period_end: string }

export function UnpaidAccounts() {
  const navigate = useNavigate();
  const [cycles, setCycles] = useState<CycleOption[]>([]);
  const [cycleId, setCycleId] = useState<number | null>(null);
  const [data, setData] = useState<UnpaidRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    invoke<CycleOption[]>('list_billing_cycles')
      .then(c => {
        if (cancelled) return;
        setCycles(c);
        if (c.length) setCycleId(c[0].id);
      })
      .catch(error => {
        if (!cancelled) toast.error(String(error));
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!cycleId) return;
    let cancelled = false;
    setLoading(true);
    invoke<UnpaidRow[]>('unpaid_accounts', { cycleId })
      .then(d => {
        if (!cancelled) setData(d);
      })
      .catch(error => {
        if (!cancelled) {
          setData([]);
          toast.error(String(error));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [cycleId]);

  const totalOutstanding = data.reduce((s, r) => s + r.outstanding_balance, 0);

  const columns: Column<UnpaidRow>[] = [
    {
      key: 'unit', header: 'Unit',
      render: r => (
        <div>
          <span className="font-mono text-xs font-medium text-gray-800">{r.building_code}-{r.unit_number}</span>
        </div>
      ),
    },
    { key: 'name', header: 'Resident', render: r => <span className="text-xs text-gray-700">{r.resident_name}</span> },
    { key: 'account', header: 'Account', render: r => <span className="font-mono text-xs text-gray-400">{r.account_number}</span> },
    { key: 'due', header: 'Total Due', width: '110px', render: r => <span className="text-xs text-gray-600">{php(r.total_amount_due)}</span> },
    {
      key: 'outstanding', header: 'Outstanding', width: '120px',
      render: r => <span className="text-sm font-semibold text-red-600">{php(r.outstanding_balance)}</span>,
    },
    {
      key: 'duedate', header: 'Due Date', width: '100px',
      render: r => r.due_date ? (
        <span className={`text-xs ${new Date(r.due_date) < new Date() ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
          {formatDate(r.due_date)}
        </span>
      ) : <span className="text-gray-300">—</span>,
    },
    {
      key: 'action', header: '', width: '80px',
      render: r => (
        <button
          onClick={e => { e.stopPropagation(); /* navigate to bill */ }}
          className="flex items-center gap-1 text-xs text-green-600 hover:text-green-800"
        >
          <CreditCard size={12} /> Pay
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative">
          <select value={cycleId ?? ''} onChange={e => setCycleId(Number(e.target.value))}
            className="appearance-none text-sm border border-gray-300 rounded-lg pl-3 pr-8 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            {cycles.map(c => <option key={c.id} value={c.id}>{c.period_start} – {c.period_end}</option>)}
          </select>
          <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>
        {data.length > 0 && (
          <span className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-1.5 rounded-full">
            {data.length} unpaid accounts · {php(totalOutstanding)} total outstanding
          </span>
        )}
      </div>
      <DataTable columns={columns} data={data} rowKey={r => r.account_number} loading={loading}
        emptyMessage="All accounts are paid for this cycle." />
    </div>
  );
}
