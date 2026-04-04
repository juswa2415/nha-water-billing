// src/pages/Ledger/AccountLedger.tsx
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useParams } from 'react-router-dom';
import { php, formatDate } from '../../utils/formatters';
import { StatusBadge } from '../../components/shared/StatusBadge';

interface BillRow {
  id: number; period_start: string; period_end: string;
  total_amount_due: number; previous_balance: number;
  total_for_month: number; status: string; due_date: string | null;
}
interface PaymentRow {
  receipt_number: string; amount_paid: number;
  remaining_balance: number; payment_date: string; is_void: boolean;
}

export function AccountLedger() {
  const { accountId } = useParams<{ accountId: string }>();
  const [bills, setBills] = useState<BillRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // In production, fetch all bills + payments for this account
    setLoading(false);
  }, [accountId]);

  return (
    <div className="max-w-3xl space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {loading ? (
          <div className="py-10 text-center text-sm text-gray-400">Loading ledger…</div>
        ) : bills.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">No transactions found for this account.</div>
        ) : (
          bills.map(b => (
            <div key={b.id} className="px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-800">{formatDate(b.period_start)} – {formatDate(b.period_end)}</p>
                <p className="text-xs text-gray-500 mt-0.5">Monthly: {php(b.total_for_month)} · Prev balance: {php(b.previous_balance)}</p>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={b.status} />
                <span className="text-sm font-semibold text-gray-900">{php(b.total_amount_due)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}