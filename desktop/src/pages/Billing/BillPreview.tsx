import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, CreditCard, Printer, Receipt } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { printHtmlDocument } from '../../services/printService';
import { billPeriod, cubicM, formatDate, php } from '../../utils/formatters';
import { StatusBadge } from '../../components/shared/StatusBadge';

interface BillRow {
  id: number;
  account_id: number;
  account_number: string;
  resident_name: string;
  unit_number: string;
  building_code: string;
  period_start: string;
  period_end: string;
  rate_per_cubicm: number;
  consumption_cubicm: number;
  water_charge: number;
  sys_loss_charge: number;
  common_sys_loss: number;
  reconnection_fee: number;
  penalty: number;
  previous_balance: number;
  total_for_month: number;
  total_amount_due: number;
  status: string;
  due_date: string | null;
  generated_at: string;
  billing_cycle_id: number;
  total_paid: number;
  remaining_balance: number;
  payments_count: number;
  latest_payment_id: number | null;
  latest_receipt_number: string | null;
  latest_payment_date: string | null;
}

interface PaymentRow {
  id: number;
  bill_id: number;
  received_by: string;
  amount_paid: number;
  remaining_balance: number;
  receipt_number: string;
  payment_date: string;
  payment_method: string;
  is_void: boolean;
}

const BILL_STATUS_LABELS: Record<string, string> = {
  draft: 'Open',
  finalized: 'Settled',
  locked: 'Closed',
};

export function BillPreview() {
  const { billId } = useParams<{ billId: string }>();
  const navigate = useNavigate();
  const { hasRole } = useAuthStore();
  const printRef = useRef<HTMLDivElement>(null);
  const [bill, setBill] = useState<BillRow | null>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!billId) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const billData = await invoke<BillRow>('get_bill', { billId: Number(billId) });
        const paymentData = await invoke<PaymentRow[]>('list_payments_for_bill', {
          billId: Number(billId),
        });

        if (!cancelled) {
          setBill(billData);
          setPayments(paymentData);
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
  }, [billId]);

  const handlePrint = () => {
    const content = printRef.current?.innerHTML;
    if (!content) {
      toast.error('Bill preview is not ready.');
      return;
    }

    try {
      printHtmlDocument({
        title: 'NHA Water Bill',
        html: content,
        styles: `
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: Arial, sans-serif; font-size: 10pt; color: #000; background: #fff; }
          .bill-page { width: 21cm; min-height: 14cm; padding: 1cm; margin: 0 auto; }
          @media print {
            body { margin: 0; }
            .bill-page { width: 100%; padding: 0.8cm; }
          }
        `,
      });
    } catch (error) {
      toast.error(String(error));
    }
  };

  if (loading) {
    return <div className="p-8 text-sm text-gray-400">Loading bill...</div>;
  }

  if (!bill) {
    return <div className="p-8 text-sm text-red-500">Bill not found.</div>;
  }

  const canRecordPayment =
    hasRole('admin', 'cashier') && bill.remaining_balance > 0 && bill.status !== 'locked';

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
            Bill - {bill.resident_name} - Unit {bill.building_code}-{bill.unit_number}
          </h2>
          <p className="text-xs text-gray-400">{billPeriod(bill.period_start, bill.period_end)}</p>
        </div>
        <div className="flex gap-2">
          {bill.latest_payment_id && bill.latest_receipt_number && (
            <button
              onClick={() => navigate(`/payments/receipt/${bill.latest_payment_id}`)}
              className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100"
            >
              <Receipt size={14} />
              Receipt #{bill.latest_receipt_number}
            </button>
          )}
          {canRecordPayment && (
            <button
              onClick={() => navigate(`/payments/new/${bill.id}`)}
              className="flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700"
            >
              <CreditCard size={14} />
              Record Payment
            </button>
          )}
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            <Printer size={14} />
            Print Bill
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-blue-900">Document type</p>
          <StatusBadge
            status={bill.status}
            label={BILL_STATUS_LABELS[bill.status] ?? bill.status.replace(/_/g, ' ')}
          />
        </div>
        <p className="mt-2 text-sm text-blue-900">
          This page is the bill or statement of account. The actual payment receipt only
          exists after a payment is posted. Use the payment history below to reopen past
          receipts.
        </p>
        <p className="mt-2 text-xs text-blue-800">
          Total collected: {php(bill.total_paid)}. Remaining balance: {php(bill.remaining_balance)}.
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Payment history for this bill</h3>
            <p className="mt-1 text-xs text-gray-500">
              Payment ID and receipt number live here, not on the bill itself.
            </p>
          </div>
          <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-600">
            {payments.length} payment{payments.length === 1 ? '' : 's'}
          </span>
        </div>

        {payments.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-500">
            No payment has been recorded for this bill yet.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {payments.map((payment) => (
              <div
                key={payment.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 px-4 py-3"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => navigate(`/payments/receipt/${payment.id}`)}
                      className="text-sm font-semibold text-blue-600 hover:text-blue-800"
                    >
                      Receipt #{payment.receipt_number}
                    </button>
                    {payment.is_void && (
                      <StatusBadge status="overdue" label="Void" />
                    )}
                  </div>
                  <p className="text-xs text-gray-500">
                    Payment ID {payment.id} - {formatDate(payment.payment_date)} -{' '}
                    {payment.payment_method.toUpperCase()}
                  </p>
                  <p className="text-xs text-gray-500">Received by {payment.received_by}</p>
                </div>

                <div className="text-right">
                  <p className="text-sm font-semibold text-gray-900">
                    {php(payment.amount_paid)}
                  </p>
                  <p className="text-xs text-gray-500">
                    Remaining {php(payment.remaining_balance)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div ref={printRef}>
          <div
            className="bill-page"
            style={{
              margin: '0 auto',
              maxWidth: '780px',
              fontFamily: 'Arial, sans-serif',
              fontSize: '10pt',
            }}
          >
            <div style={{ marginBottom: '6px', textAlign: 'center' }}>
              <div style={{ fontSize: '11pt', fontWeight: 'bold' }}>
                NATIONAL HOUSING AUTHORITY
              </div>
              <div style={{ fontSize: '10pt' }}>Caloocan District Office</div>
              <div style={{ fontSize: '10pt' }}>
                Camarin Residences 3 - {bill.building_code}
              </div>
            </div>

            <div
              style={{
                marginBottom: '4px',
                display: 'flex',
                justifyContent: 'flex-end',
                fontSize: '9pt',
              }}
            >
              <span>
                Date <strong>{formatDate(bill.generated_at)}</strong>
              </span>
            </div>

            <div style={{ marginBottom: '2px', textAlign: 'center', fontSize: '10pt', fontWeight: 'bold' }}>
              STATEMENT OF ACCOUNT
            </div>
            <div style={{ marginBottom: '8px', textAlign: 'center', fontSize: '9pt' }}>
              {formatDate(bill.period_start)} - {formatDate(bill.period_end)}
              <br />
              <strong>WATER METER READING</strong>
            </div>

            <hr style={{ marginBottom: '6px', border: 'none', borderTop: '1px solid #000' }} />

            <div style={{ display: 'flex', gap: '20px' }}>
              <div style={{ flex: '0 0 42%' }}>
                <div style={{ marginBottom: '4px', display: 'flex', gap: '6px', fontSize: '9pt' }}>
                  <strong>Name</strong>
                  <span style={{ flex: 1, borderBottom: '1px solid #000', paddingBottom: '1px' }}>
                    {bill.resident_name}
                  </span>
                </div>
                <div style={{ marginBottom: '10px', display: 'flex', gap: '6px', fontSize: '9pt' }}>
                  <strong>Unit</strong>
                  <span style={{ width: '60px', borderBottom: '1px solid #000', paddingBottom: '1px' }}>
                    {bill.unit_number}
                  </span>
                </div>

                <div style={{ marginBottom: '2px', display: 'flex', justifyContent: 'space-between', fontSize: '9pt' }}>
                  <span>Total Consumption</span>
                  <span>{cubicM(bill.consumption_cubicm)}</span>
                </div>
                <div style={{ marginBottom: '2px', display: 'flex', justifyContent: 'space-between', fontSize: '9pt' }}>
                  <span>Price/Cu. M.</span>
                  <span>P {bill.rate_per_cubicm.toFixed(2)}</span>
                </div>
                <div style={{ marginBottom: '4px', display: 'flex', justifyContent: 'space-between', fontSize: '9pt' }}>
                  <span>Water Bill for the Month</span>
                  <span style={{ borderBottom: '1px solid #000', fontWeight: 'bold', paddingRight: '4px' }}>
                    P {bill.water_charge.toFixed(2)}
                  </span>
                </div>

                <div style={{ marginBottom: '2px', fontSize: '9pt' }}>Add:</div>
                {[
                  ['Building System Loss Charge', bill.sys_loss_charge],
                  ['Common Systems Loss Charge', bill.common_sys_loss],
                  ['Reconnection Fee', bill.reconnection_fee],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    style={{ marginBottom: '2px', display: 'flex', justifyContent: 'space-between', fontSize: '9pt' }}
                  >
                    <span>{label}</span>
                    <span style={{ borderBottom: '1px solid #000', paddingRight: '4px' }}>
                      {(value as number).toFixed(2)}
                    </span>
                  </div>
                ))}

                <hr style={{ margin: '4px 0', border: 'none', borderTop: '1px solid #000' }} />

                <div style={{ marginBottom: '2px', display: 'flex', justifyContent: 'space-between', fontSize: '9pt' }}>
                  <strong>Total Due for the Month</strong>
                  <span style={{ borderBottom: '1px solid #000', fontWeight: 'bold', paddingRight: '4px' }}>
                    P {bill.total_for_month.toFixed(2)}
                  </span>
                </div>
                <div style={{ marginBottom: '6px', display: 'flex', justifyContent: 'space-between', fontSize: '9pt' }}>
                  <span>Add Previous Balance</span>
                  <span>{bill.previous_balance.toFixed(2)}</span>
                </div>

                <hr style={{ margin: '4px 0', border: 'none', borderTop: '2px solid #000' }} />
                <div
                  style={{
                    marginBottom: '10px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '10pt',
                    fontWeight: 'bold',
                  }}
                >
                  <span>TOTAL AMOUNT DUE</span>
                  <span style={{ borderBottom: '3px double #000', paddingRight: '4px' }}>
                    P {bill.total_amount_due.toFixed(2)}
                  </span>
                </div>

                <div style={{ marginBottom: '6px', fontSize: '9pt' }}>
                  <strong>DUE DATE:</strong> {bill.due_date ? formatDate(bill.due_date) : '-'}
                </div>

                <div style={{ marginBottom: '4px', fontSize: '8.5pt' }}>Please pay your bill to:</div>
                <div style={{ marginBottom: '2px', fontSize: '9pt', fontWeight: 'bold' }}>
                  CRISTINA ALACEDA &
                </div>
                <div style={{ marginBottom: '2px', fontSize: '9pt', fontWeight: 'bold' }}>
                  LORENA SEVILLA
                </div>
                <div style={{ marginBottom: '2px', fontSize: '8.5pt' }}>
                  @ Camres 1 Livelihood Center
                </div>
                <div style={{ marginBottom: '8px', fontSize: '8.5pt' }}>
                  every Tues, Thurs. & Fri. 9:30 AM - 12:00 PM
                </div>

                <div
                  style={{
                    borderTop: '1px solid #000',
                    paddingTop: '4px',
                    fontSize: '8.5pt',
                    fontStyle: 'italic',
                  }}
                >
                  <strong>Notice of Disconnection:</strong>
                  <br />
                  If your bill is still unpaid, disconnection may happen after{' '}
                  <strong>
                    {bill.due_date
                      ? formatDate(
                          new Date(
                            new Date(bill.due_date).getTime() + 7 * 24 * 60 * 60 * 1000,
                          ).toISOString(),
                        )
                      : '-'}
                  </strong>
                </div>
              </div>

              <div style={{ flex: 1 }}>
                <div style={{ marginBottom: '3px', fontSize: '9pt', fontWeight: 'bold' }}>
                  Computation of Systems Loss @ {bill.building_code}:
                </div>
                {[
                  [`${bill.building_code} Sub-meter Present Reading (cu.m.)`, '-'],
                  [`Less: ${bill.building_code} Sub-meter Previous Reading (cu.m.)`, '-'],
                  [`Total Consumption of ${bill.building_code} (cu.m.)`, '-'],
                  ['Less: Total Consumption based on Individual Meter Reading (cu.m.)', '-'],
                  [`Total System Loss of ${bill.building_code} (cu.m.)`, '-'],
                  ['Multiply by Rate per Cubic Meter in PhP', bill.rate_per_cubicm.toFixed(2)],
                  [`Total System Loss of ${bill.building_code} in PhP`, '-'],
                  [`Divided by: No. of Units at ${bill.building_code}`, '-'],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    style={{ marginBottom: '1px', display: 'flex', justifyContent: 'space-between', fontSize: '8.5pt' }}
                  >
                    <span style={{ paddingRight: '8px' }}>{label}</span>
                    <span style={{ fontWeight: 'bold' }}>{value}</span>
                  </div>
                ))}
                <div
                  style={{
                    marginBottom: '8px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    borderBottom: '2px solid #000',
                    paddingBottom: '2px',
                    fontSize: '9pt',
                    fontWeight: 'bold',
                  }}
                >
                  <span>Systems Loss per Unit at {bill.building_code} in PhP</span>
                  <span>{bill.sys_loss_charge.toFixed(2)}</span>
                </div>

                <div style={{ marginBottom: '3px', fontSize: '9pt', fontWeight: 'bold' }}>
                  Computation of Common Systems Loss at CamRes 3:
                </div>
                {[
                  ['Total Consumption based on Maynilad Bill (cu.m.)', '-'],
                  ['Less: Total Consumption from Submeters of 10 Bldgs. (cu.m.)', '-'],
                  ['Common Systems Loss @ CamRes 3 (cu.m.)', '-'],
                  ['Multiply by Rate per Cubic Meter (PhP)', bill.rate_per_cubicm.toFixed(2)],
                  ['Total Common System Loss @ CamRes 3 (PhP)', '-'],
                  ['Divided by: No. of Units at CamRes 3', '-'],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    style={{ marginBottom: '1px', display: 'flex', justifyContent: 'space-between', fontSize: '8.5pt' }}
                  >
                    <span style={{ paddingRight: '8px' }}>{label}</span>
                    <span style={{ fontWeight: 'bold' }}>{value}</span>
                  </div>
                ))}
                <div
                  style={{
                    marginBottom: '8px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    borderBottom: '2px solid #000',
                    paddingBottom: '2px',
                    fontSize: '9pt',
                    fontWeight: 'bold',
                  }}
                >
                  <span>Common System Loss Per Unit @ CamRes 3 (PhP)</span>
                  <span>{bill.common_sys_loss.toFixed(2)}</span>
                </div>

                <div style={{ marginBottom: '4px', fontSize: '9pt', fontWeight: 'bold' }}>
                  Individual Reading
                </div>
                <table style={{ width: '60%', borderCollapse: 'collapse', fontSize: '9pt' }}>
                  <tbody>
                    {[
                      ['Present Reading', '-'],
                      ['Previous Reading', '-'],
                      ['Total Consumption', cubicM(bill.consumption_cubicm)],
                    ].map(([label, value]) => (
                      <tr key={label}>
                        <td style={{ paddingRight: '12px' }}>{label}</td>
                        <td
                          style={{
                            borderBottom: '1px solid #000',
                            paddingRight: '4px',
                            textAlign: 'right',
                            fontWeight: 'bold',
                          }}
                        >
                          {value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div style={{ marginTop: '10px', textAlign: 'center', fontSize: '8.5pt', fontStyle: 'italic' }}>
                  For bill correction, ask assistance from the billing office or your building
                  representative.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
