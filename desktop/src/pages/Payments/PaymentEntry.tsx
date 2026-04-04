import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, CreditCard } from 'lucide-react';
import { billPeriod, php } from '../../utils/formatters';

interface BillRow {
  id: number;
  account_number: string;
  resident_name: string;
  unit_number: string;
  building_code: string;
  period_start: string;
  period_end: string;
  water_charge: number;
  sys_loss_charge: number;
  common_sys_loss: number;
  reconnection_fee: number;
  previous_balance: number;
  total_for_month: number;
  total_amount_due: number;
  status: string;
  total_paid: number;
  remaining_balance: number;
}

interface PaymentResult {
  payment_id: number;
  receipt_number: string;
  remaining_balance: number;
}

export function PaymentEntry() {
  const { billId } = useParams<{ billId: string }>();
  const navigate = useNavigate();
  const [bill, setBill] = useState<BillRow | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!billId) {
      return;
    }

    invoke<BillRow>('get_bill', { billId: Number(billId) })
      .then((data) => {
        setBill(data);
        const suggestedAmount =
          data.remaining_balance > 0 ? data.remaining_balance : data.total_amount_due;
        setAmount(suggestedAmount.toFixed(2));
      })
      .finally(() => setLoading(false));
  }, [billId]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!bill) {
      return;
    }

    const paid = parseFloat(amount);
    if (Number.isNaN(paid) || paid <= 0) {
      toast.error('Enter a valid payment amount.');
      return;
    }

    setSaving(true);
    try {
      const response = await invoke<PaymentResult>('record_payment', {
        payload: {
          bill_id: bill.id,
          amount_paid: paid,
          period_start: bill.period_start,
          period_end: bill.period_end,
          payment_method: method,
        },
      });

      toast.success(`Payment recorded. Receipt #${response.receipt_number}`);
      navigate(`/payments/receipt/${response.payment_id}`, {
        replace: true,
        state: { fresh: true },
      });
    } catch (error) {
      toast.error(String(error));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-sm text-gray-400">Loading...</div>;
  }

  if (!bill) {
    return <div className="p-8 text-sm text-red-500">Bill not found.</div>;
  }

  const isSettled = bill.remaining_balance <= 0 || bill.status === 'locked';
  const enteredAmount = parseFloat(amount) || 0;
  const change = enteredAmount - bill.remaining_balance;

  return (
    <div className="max-w-xl space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="rounded-lg p-1.5 transition-colors hover:bg-gray-100"
        >
          <ArrowLeft size={16} className="text-gray-500" />
        </button>
        <h2 className="text-sm font-semibold text-gray-900">Record Payment</h2>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <p className="font-semibold text-gray-900">{bill.resident_name}</p>
            <p className="font-mono text-xs text-gray-500">
              {bill.building_code}-{bill.unit_number} - {bill.account_number}
            </p>
            <p className="mt-0.5 text-xs text-gray-400">
              {billPeriod(bill.period_start, bill.period_end)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">Total Amount Due</p>
            <p className="text-2xl font-bold text-gray-900">{php(bill.total_amount_due)}</p>
            {bill.total_paid > 0 && (
              <p className="mt-1 text-xs text-gray-500">
                Collected: {php(bill.total_paid)} | Remaining: {php(bill.remaining_balance)}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-1.5 border-t border-gray-100 pt-3">
          {[
            { label: 'Water charge', value: bill.water_charge },
            { label: 'Building system loss', value: bill.sys_loss_charge },
            { label: 'Common system loss', value: bill.common_sys_loss },
            { label: 'Reconnection fee', value: bill.reconnection_fee },
          ].map(
            (row) =>
              row.value > 0 && (
                <div key={row.label} className="flex justify-between text-xs text-gray-600">
                  <span>{row.label}</span>
                  <span>{php(row.value)}</span>
                </div>
              ),
          )}
          <div className="mt-1 flex justify-between border-t border-gray-100 pt-1.5 text-xs font-medium text-gray-800">
            <span>Total for month</span>
            <span>{php(bill.total_for_month)}</span>
          </div>
          {bill.previous_balance > 0 && (
            <div className="flex justify-between text-xs text-red-600">
              <span>Previous balance</span>
              <span>+ {php(bill.previous_balance)}</span>
            </div>
          )}
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-xl border border-gray-200 bg-white p-5"
      >
        <h3 className="text-sm font-semibold text-gray-800">Payment Details</h3>

        {isSettled && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            This bill is already fully settled. Open the existing receipt instead of
            recording another payment.
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-600">
            Amount Received (PHP)
          </label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
            autoFocus
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-600">
            Payment Method
          </label>
          <select
            value={method}
            onChange={(event) => setMethod(event.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="cash">Cash</option>
            <option value="gcash">GCash</option>
            <option value="bank">Bank Transfer</option>
          </select>
        </div>

        {enteredAmount > 0 && (
          <div
            className={`rounded-lg p-3 text-sm ${
              change >= 0
                ? 'border border-green-200 bg-green-50 text-green-800'
                : 'border border-yellow-200 bg-yellow-50 text-yellow-800'
            }`}
          >
            {change >= 0 ? (
              <>
                Change: <strong>{php(change)}</strong> | Remaining balance:{' '}
                <strong>PHP 0.00</strong>
              </>
            ) : (
              <>
                Partial payment | Remaining balance:{' '}
                <strong>{php(Math.abs(change))}</strong>
              </>
            )}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !amount || isSettled}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-60"
          >
            <CreditCard size={15} />
            {saving ? 'Recording...' : 'Record Payment & Print Receipt'}
          </button>
        </div>
      </form>
    </div>
  );
}
