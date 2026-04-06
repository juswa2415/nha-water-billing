import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Layers3, Printer, RotateCcw } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { billPeriod, formatDate, php } from '../../utils/formatters';
import { printHtmlDocument } from '../../services/printService';

interface PaymentRow {
  id: number;
  bill_id: number;
  received_by: string;
  amount_paid: number;
  remaining_balance: number;
  account_balance_after: number;
  receipt_number: string;
  receipt_group_number: string;
  payment_date: string;
  period_start: string | null;
  period_end: string | null;
  payment_method: string;
  is_void: boolean;
  void_reason: string | null;
  void_at: string | null;
  created_at: string;
}

interface BillRow {
  id: number;
  resident_name: string;
  unit_number: string;
  building_code: string;
  account_number: string;
  total_for_month: number;
  total_amount_due: number;
  previous_balance: number;
  billing_cycle_id: number;
}

type ReceiptLocationState = {
  fresh?: boolean;
} | null;

export function ReceiptView() {
  const { paymentId } = useParams<{ paymentId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { hasRole } = useAuthStore();
  const printRef = useRef<HTMLDivElement>(null);
  const [payment, setPayment] = useState<PaymentRow | null>(null);
  const [bill, setBill] = useState<BillRow | null>(null);
  const [groupPayments, setGroupPayments] = useState<PaymentRow[]>([]);
  const [billsById, setBillsById] = useState<Record<number, BillRow>>({});
  const [loading, setLoading] = useState(true);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');

  useEffect(() => {
    if (!paymentId) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const paymentRow = await invoke<PaymentRow>('get_payment', {
          paymentId: Number(paymentId),
        });
        const paymentRows = await invoke<PaymentRow[]>('list_payments_for_receipt_group', {
          receiptGroupNumber: paymentRow.receipt_group_number || paymentRow.receipt_number,
        });
        const uniqueBillIds = Array.from(new Set(paymentRows.map((row) => row.bill_id)));
        const billRows = await Promise.all(
          uniqueBillIds.map(async (currentBillId) =>
            invoke<BillRow>('get_bill', { billId: currentBillId }),
          ),
        );
        const billMap = Object.fromEntries(billRows.map((row) => [row.id, row]));
        const representativeBill = billMap[paymentRow.bill_id] ?? billRows[0];

        if (!cancelled) {
          setPayment(paymentRow);
          setGroupPayments(paymentRows);
          setBillsById(billMap);
          setBill(representativeBill);
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(String(error));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [paymentId]);

  const isFreshView = Boolean((location.state as ReceiptLocationState)?.fresh);

  const handlePrint = (watermark: string | null) => {
    const content = printRef.current?.innerHTML;
    if (!content) {
      toast.error('Receipt preview is not ready.');
      return;
    }

    const watermarkHtml = watermark
      ? `<div class="receipt-watermark">${watermark}</div>`
      : '';

    try {
      printHtmlDocument({
        title: `NHA Water Receipt ${displayReceiptNumber}`,
        html: `${content}${watermarkHtml}`,
        styles: `
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: Arial, sans-serif; font-size: 10pt; background: #fff; }
          .receipt { width: 14cm; min-height: 10cm; border: 2px solid #000; padding: 0.8cm; margin: 0.5cm auto; position: relative; }
          .receipt-watermark {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) rotate(-30deg);
            font-size: 46pt;
            font-weight: bold;
            color: rgba(220, 38, 38, 0.14);
            white-space: nowrap;
            pointer-events: none;
          }
          @media print {
            body { margin: 0; }
            .receipt { margin: 0; width: 100%; }
          }
        `,
      });
    } catch (error) {
      toast.error(String(error));
    }
  };

  const handleVoid = async () => {
    if (!voidReason.trim() || !paymentId) {
      return;
    }

    try {
      await invoke('void_payment', {
        payload: { payment_id: Number(paymentId), void_reason: voidReason },
      });
      toast.success('Payment voided.');
      setVoidOpen(false);
      navigate(-1);
    } catch (error) {
      toast.error(String(error));
    }
  };

  if (loading) {
    return <div className="p-8 text-sm text-gray-400">Loading receipt...</div>;
  }

  if (!payment || !bill) {
    return <div className="p-8 text-sm text-red-500">Receipt not found.</div>;
  }

  const receiptPayments = groupPayments.length > 0 ? groupPayments : [payment];
  const isGroupedReceipt = receiptPayments.length > 1;
  const displayReceiptNumber = payment.receipt_group_number || payment.receipt_number;
  const totalApplied = receiptPayments.reduce((sum, row) => sum + row.amount_paid, 0);
  const totalCurrentCharges = receiptPayments.reduce(
    (sum, row) => sum + (billsById[row.bill_id]?.total_for_month ?? 0),
    0,
  );
  const totalPreviousBalances = receiptPayments.reduce(
    (sum, row) => sum + (billsById[row.bill_id]?.previous_balance ?? 0),
    0,
  );

  const printMode = payment.is_void
    ? hasRole('admin')
      ? 'void-copy'
      : 'disabled'
    : isFreshView
      ? hasRole('admin', 'cashier')
        ? 'original'
        : 'disabled'
      : hasRole('admin')
        ? 'copy'
        : 'disabled';

  const printLabel =
    printMode === 'original'
      ? 'Print Original Receipt'
      : printMode === 'copy'
        ? 'Reprint Copy'
        : printMode === 'void-copy'
          ? 'Print Void Copy'
          : 'Admin Reprint Only';

  const printWatermark =
    printMode === 'copy' ? 'COPY' : printMode === 'void-copy' ? 'VOID COPY' : null;
  const accountBalanceLabel =
    payment.account_balance_after < 0
      ? 'Credit carried forward'
      : 'Account balance after payment';
  const accountBalanceDisplay =
    payment.account_balance_after < 0
      ? `CR ${Math.abs(payment.account_balance_after).toFixed(2)}`
      : payment.account_balance_after.toFixed(2);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="rounded-lg p-1.5 transition-colors hover:bg-gray-100"
        >
          <ArrowLeft size={16} className="text-gray-500" />
        </button>
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-gray-900">
            Receipt #{displayReceiptNumber}
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            Payment group of {receiptPayments.length} allocation
            {receiptPayments.length === 1 ? '' : 's'} - Lead payment ID {payment.id}
          </p>
        </div>
        <div className="flex gap-2">
          {!payment.is_void && hasRole('admin') && (
            <button
              onClick={() => setVoidOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50"
            >
              <RotateCcw size={13} />
              Void
            </button>
          )}
          <button
            onClick={() => handlePrint(printWatermark)}
            disabled={printMode === 'disabled'}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Printer size={14} />
            {printLabel}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-blue-900">Receipt access</p>
          {payment.is_void && <StatusBadge status="overdue" label="Void" />}
          {!payment.is_void && !isFreshView && <StatusBadge status="approved" label="Stored copy" />}
        </div>
        <p className="mt-2 text-sm text-blue-900">
          {isFreshView
            ? 'This is the original receipt created from the payment you just posted.'
            : 'This is a stored receipt record. Historical prints should be treated as controlled copies, not as the original issue.'}
        </p>
        <p className="mt-2 text-xs text-blue-800">
          Cashiers can print the original right after posting a payment. Later reprints are
          admin-controlled copies.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-blue-200 bg-white px-3 py-1 text-blue-800">
            Receipt group #{displayReceiptNumber}
          </span>
          <span className="rounded-full border border-blue-200 bg-white px-3 py-1 text-blue-800">
            {receiptPayments.length} bill allocation{receiptPayments.length === 1 ? '' : 's'}
          </span>
          <span className="rounded-full border border-blue-200 bg-white px-3 py-1 text-blue-800">
            Total applied {php(totalApplied)}
          </span>
        </div>
      </div>

      <div className="flex justify-center">
        <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div ref={printRef}>
            <div
              className="receipt"
              style={{
                position: 'relative',
                margin: '0 auto',
                maxWidth: '520px',
                border: '2px solid #000',
                padding: '24px',
                fontFamily: 'Arial, sans-serif',
                fontSize: '10pt',
              }}
            >
              {payment.is_void && (
                <div
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%) rotate(-30deg)',
                    fontSize: '48pt',
                    fontWeight: 'bold',
                    color: 'rgba(255, 0, 0, 0.15)',
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                  }}
                >
                  VOID
                </div>
              )}

              <div style={{ marginBottom: '8px', textAlign: 'center' }}>
                <div style={{ fontSize: '11pt', fontWeight: 'bold' }}>
                  NATIONAL HOUSING AUTHORITY
                </div>
                <div style={{ fontSize: '9.5pt' }}>Caloocan District Office</div>
                <div style={{ fontSize: '9.5pt' }}>
                  Camarin Residences 3 - {bill.building_code}
                </div>
              </div>

              <div
                style={{
                  margin: '6px 0',
                  textAlign: 'center',
                  fontSize: '12pt',
                  fontWeight: 'bold',
                  letterSpacing: '1px',
                }}
              >
                ACKNOWLEDGEMENT RECEIPT - WATER
              </div>

              <div style={{ position: 'absolute', top: '24px', right: '24px', textAlign: 'right' }}>
                <div style={{ fontSize: '8pt', color: '#666' }}>No.</div>
                <div
                  style={{
                    fontFamily: 'monospace',
                    fontSize: '14pt',
                    fontWeight: 'bold',
                  }}
                >
                  {displayReceiptNumber}
                </div>
              </div>

              <div
                style={{
                  marginTop: '4px',
                  marginBottom: '8px',
                  display: 'flex',
                  alignItems: 'flex-end',
                  gap: '6px',
                  fontSize: '9pt',
                }}
              >
                <strong>DATE:</strong>
                <span style={{ flex: 1, borderBottom: '1px solid #000' }}>
                  {formatDate(payment.payment_date)}
                </span>
              </div>

              <div
                style={{
                  marginBottom: '6px',
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'flex-end',
                  gap: '6px',
                  fontSize: '9pt',
                }}
              >
                <strong>Received from</strong>
                <span style={{ minWidth: '120px', flex: 2, borderBottom: '1px solid #000' }}>
                  {bill.resident_name}
                </span>
                <strong>, Unit</strong>
                <span style={{ width: '50px', borderBottom: '1px solid #000' }}>
                  {bill.unit_number}
                </span>
                <strong>the amount of</strong>
              </div>

              <div
                style={{
                  marginBottom: '8px',
                  display: 'flex',
                  alignItems: 'flex-end',
                  gap: '6px',
                  fontSize: '9pt',
                }}
              >
                <strong>(PhP.</strong>
                <span style={{ flex: 1, borderBottom: '1px solid #000', fontWeight: 'bold' }}>
                  {totalApplied.toFixed(2)}
                </span>
                <strong>)</strong>
              </div>

              <div style={{ marginBottom: '8px', fontSize: '9pt' }}>
                Payment covers{' '}
                <strong>{receiptPayments.length}</strong> billing period
                {receiptPayments.length === 1 ? '' : 's'} under this account.
              </div>

              {isGroupedReceipt ? (
                <>
                  <div
                    style={{
                      marginBottom: '10px',
                      borderTop: '1px solid #000',
                      paddingTop: '6px',
                    }}
                  >
                    <div
                      style={{
                        marginBottom: '4px',
                        fontSize: '8.5pt',
                        fontWeight: 'bold',
                      }}
                    >
                      PAYMENT ALLOCATIONS
                    </div>
                    {receiptPayments.map((row) => (
                      <div
                        key={row.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: '12px',
                          marginBottom: '3px',
                          fontSize: '8.5pt',
                        }}
                      >
                        <span>
                          {row.period_start && row.period_end
                            ? billPeriod(row.period_start, row.period_end)
                            : 'Billing period'}
                        </span>
                        <span
                          style={{
                            minWidth: '90px',
                            borderBottom: '1px solid #000',
                            textAlign: 'right',
                          }}
                        >
                          {row.amount_paid.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div
                    style={{ borderTop: '1px solid #000', paddingTop: '6px', fontSize: '9.5pt' }}
                  >
                    <div
                      style={{
                        marginBottom: '3px',
                        display: 'flex',
                        justifyContent: 'space-between',
                      }}
                    >
                      <strong>TOTAL CASH POSTED</strong>
                      <strong
                        style={{
                          minWidth: '100px',
                          borderBottom: '1px solid #000',
                          textAlign: 'right',
                        }}
                      >
                        {totalApplied.toFixed(2)}
                      </strong>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontWeight: 'bold',
                      }}
                    >
                      <span>{accountBalanceLabel}</span>
                      <span
                        style={{
                          minWidth: '100px',
                          borderBottom: '3px double #000',
                          textAlign: 'right',
                        }}
                      >
                        {accountBalanceDisplay}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ marginBottom: '6px', fontSize: '9pt' }}>
                    <div
                      style={{
                        marginBottom: '3px',
                        display: 'flex',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span>Current Water Bill</span>
                      <span
                        style={{
                          width: '100px',
                          borderBottom: '1px solid #000',
                          textAlign: 'right',
                        }}
                      >
                        {totalCurrentCharges.toFixed(2)}
                      </span>
                    </div>
                    <div
                      style={{
                        marginBottom: '3px',
                        display: 'flex',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span>Previous Balance</span>
                      <span
                        style={{
                          width: '100px',
                          borderBottom: '1px solid #000',
                          textAlign: 'right',
                        }}
                      >
                        {totalPreviousBalances > 0 ? totalPreviousBalances.toFixed(2) : ''}
                      </span>
                    </div>
                  </div>

                  <div
                    style={{ borderTop: '1px solid #000', paddingTop: '6px', fontSize: '9.5pt' }}
                  >
                    <div
                      style={{
                        marginBottom: '3px',
                        display: 'flex',
                        justifyContent: 'space-between',
                      }}
                    >
                      <strong>TOTAL AMOUNT DUE</strong>
                      <strong
                        style={{
                          minWidth: '100px',
                          borderBottom: '1px solid #000',
                          textAlign: 'right',
                        }}
                      >
                        {(totalCurrentCharges + totalPreviousBalances).toFixed(2)}
                      </strong>
                    </div>
                    <div
                      style={{
                        marginBottom: '3px',
                        display: 'flex',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span>Less: Payment</span>
                      <span
                        style={{
                          minWidth: '100px',
                          borderBottom: '1px solid #000',
                          textAlign: 'right',
                        }}
                      >
                        {totalApplied.toFixed(2)}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontWeight: 'bold',
                      }}
                    >
                      <span>{accountBalanceLabel}</span>
                      <span
                        style={{
                          minWidth: '100px',
                          borderBottom: '3px double #000',
                          textAlign: 'right',
                        }}
                      >
                        {accountBalanceDisplay}
                      </span>
                    </div>
                  </div>
                </>
              )}

              <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{ textAlign: 'center' }}>
                  <div
                    style={{
                      width: '130px',
                      borderTop: '1px solid #000',
                      paddingTop: '3px',
                      fontSize: '8.5pt',
                    }}
                  >
                    Cashier/Collector
                  </div>
                  <div style={{ fontSize: '8.5pt', color: '#555' }}>{payment.received_by}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <Layers3 size={16} className="text-blue-600" />
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Receipt allocations</h3>
            <p className="text-xs text-gray-500">
              This cashier transaction can settle one or several monthly bills under the same
              account.
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {receiptPayments.map((row) => {
            const paymentBill = billsById[row.bill_id];

            return (
              <div
                key={row.id}
                className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {row.period_start && row.period_end
                        ? billPeriod(row.period_start, row.period_end)
                        : 'Billing period'}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      Bill ID {row.bill_id} · Payment line ID {row.id}
                    </p>
                  </div>
                  <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800">
                    Applied {php(row.amount_paid)}
                  </span>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500">Current month</p>
                    <p className="mt-1 text-sm font-medium text-gray-800">
                      {php(paymentBill?.total_for_month ?? 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500">Previous balance</p>
                    <p className="mt-1 text-sm font-medium text-gray-800">
                      {php(paymentBill?.previous_balance ?? 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500">Bill total</p>
                    <p className="mt-1 text-sm font-medium text-gray-800">
                      {php(paymentBill?.total_amount_due ?? 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500">
                      Bill remaining after line
                    </p>
                    <p
                      className={`mt-1 text-sm font-semibold ${
                        row.remaining_balance > 0
                          ? 'text-amber-700'
                          : row.remaining_balance < 0
                            ? 'text-blue-700'
                            : 'text-green-700'
                      }`}
                    >
                      {row.remaining_balance < 0
                        ? `CR ${php(Math.abs(row.remaining_balance))}`
                        : php(row.remaining_balance)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {voidOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setVoidOpen(false)} />
          <div className="relative mx-4 w-full max-w-sm rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
            <h3 className="mb-1 text-sm font-semibold text-gray-900">
              Void Receipt #{displayReceiptNumber}
            </h3>
            <p className="mb-3 text-xs text-gray-500">
              This action requires admin approval. Provide a reason.
            </p>
            <textarea
              value={voidReason}
              onChange={(event) => setVoidReason(event.target.value)}
              rows={3}
              className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Reason for voiding this payment..."
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setVoidOpen(false)}
                className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={handleVoid}
                disabled={!voidReason.trim()}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                Void Payment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
