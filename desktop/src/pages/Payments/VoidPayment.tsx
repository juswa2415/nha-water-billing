import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import toast from 'react-hot-toast';
import { Search } from 'lucide-react';
import { ReceiptCard } from '../../components/billing/ReceiptCard';

interface PaymentRow {
  id: number;
  bill_id: number;
  amount_paid: number;
  remaining_balance: number;
  receipt_number: string;
  payment_date: string;
  is_void: boolean;
}

interface BillRow {
  resident_name: string;
  building_code: string;
  unit_number: string;
}

export function VoidPayment() {
  const navigate = useNavigate();
  const [paymentId, setPaymentId] = useState('');
  const [payment, setPayment] = useState<PaymentRow | null>(null);
  const [bill, setBill] = useState<BillRow | null>(null);
  const [loading, setLoading] = useState(false);

  const lookup = async () => {
    const id = Number(paymentId);
    if (!Number.isFinite(id) || id <= 0) {
      toast.error('Enter a valid payment ID.');
      return;
    }

    setLoading(true);
    try {
      const paymentRow = await invoke<PaymentRow>('get_payment', { paymentId: id });
      const billRow = await invoke<BillRow>('get_bill', { billId: paymentRow.bill_id });
      setPayment(paymentRow);
      setBill(billRow);
    } catch (error: any) {
      setPayment(null);
      setBill(null);
      toast.error(error.toString());
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-900">Void Payment</h2>
        <p className="mt-1 text-sm text-gray-500">
          Payment voiding remains admin-only. Use this lookup page to open the receipt, then complete the void action from the receipt view so the audit trail stays attached to the original payment.
        </p>
        <div className="mt-4 flex gap-2">
          <input
            type="number"
            min="1"
            value={paymentId}
            onChange={(event) => setPaymentId(event.target.value)}
            placeholder="Enter payment ID"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={() => void lookup()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
          >
            <Search size={14} />
            {loading ? 'Searching...' : 'Lookup'}
          </button>
        </div>
      </div>

      {payment && bill && (
        <ReceiptCard
          receiptNumber={payment.receipt_number}
          residentName={bill.resident_name}
          buildingCode={bill.building_code}
          unitNumber={bill.unit_number}
          paymentDate={payment.payment_date}
          amountPaid={payment.amount_paid}
          remainingBalance={payment.remaining_balance}
          isVoid={payment.is_void}
          onOpen={() => navigate(`/payments/receipt/${payment.id}`)}
        />
      )}
    </div>
  );
}
