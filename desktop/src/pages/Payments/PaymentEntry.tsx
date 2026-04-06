import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Banknote,
  CreditCard,
  Landmark,
  Layers3,
  Receipt,
  Smartphone,
} from 'lucide-react';
import { billPeriod, formatDate, php } from '../../utils/formatters';

interface BillRow {
  id: number;
  account_id: number;
  account_number: string;
  resident_name: string;
  unit_number: string;
  building_code: string;
  billing_cycle_id: number;
  period_start: string;
  period_end: string;
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
  total_paid: number;
  remaining_balance: number;
  account_outstanding_balance: number;
}

interface AccountBillPaymentRow {
  id: number;
  billing_cycle_id: number;
  period_start: string;
  period_end: string;
  status: string;
  due_date: string | null;
  previous_balance: number;
  total_for_month: number;
  total_amount_due: number;
  total_paid_on_bill: number;
  local_remaining_balance: number;
  effective_open_balance: number;
  is_oldest_open: boolean;
}

interface PaymentResult {
  payment_id: number;
  receipt_number: string;
  remaining_balance: number;
  allocations_count: number;
}

type SettlementMode = 'oldest' | 'all';

interface AllocationPreviewRow {
  billId: number;
  periodLabel: string;
  dueDate: string | null;
  exactOpenBefore: number;
  applied: number;
  remainingAfter: number;
  localRemainingBalance: number;
  totalForMonth: number;
  totalAmountDue: number;
}

const round2 = (value: number) => {
  const rounded = Math.round(value * 100) / 100;
  return Math.abs(rounded) < 0.005 ? 0 : rounded;
};

const formatMoneyInput = (value: number) => value.toFixed(2);

const getRoundedCashDue = (value: number) => {
  if (value <= 0) {
    return 0;
  }

  return round2(Math.ceil(value));
};

export function PaymentEntry() {
  const { billId } = useParams<{ billId: string }>();
  const navigate = useNavigate();
  const [bill, setBill] = useState<BillRow | null>(null);
  const [accountBills, setAccountBills] = useState<AccountBillPaymentRow[]>([]);
  const [amount, setAmount] = useState('');
  const [settlementMode, setSettlementMode] = useState<SettlementMode>('oldest');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!billId) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const currentBill = await invoke<BillRow>('get_bill', { billId: Number(billId) });
        const obligations = await invoke<AccountBillPaymentRow[]>('list_bills_for_account', {
          accountId: currentBill.account_id,
        });

        if (cancelled) {
          return;
        }

        setBill(currentBill);
        setAccountBills(obligations);

        const openObligations = obligations.filter((row) => row.effective_open_balance > 0);
        const oldestOpen = openObligations.find((row) => row.is_oldest_open);
        const totalOpen = round2(
          openObligations.reduce((sum, row) => sum + row.effective_open_balance, 0),
        );
        const nextMode: SettlementMode = openObligations.length > 1 ? 'all' : 'oldest';
        setSettlementMode(nextMode);

        if (nextMode === 'all' && totalOpen > 0) {
          setAmount(formatMoneyInput(getRoundedCashDue(totalOpen)));
        } else if (oldestOpen) {
          setAmount(formatMoneyInput(getRoundedCashDue(oldestOpen.effective_open_balance)));
        } else {
          setAmount('');
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

  const oldestOpenBill = useMemo(
    () => accountBills.find((row) => row.is_oldest_open) ?? null,
    [accountBills],
  );
  const openBills = useMemo(
    () => accountBills.filter((row) => row.effective_open_balance > 0),
    [accountBills],
  );

  const totalAccountOutstanding = useMemo(
    () =>
      round2(accountBills.reduce((sum, row) => sum + Math.max(row.effective_open_balance, 0), 0)),
    [accountBills],
  );

  const requestedBill = useMemo(
    () => accountBills.find((row) => row.id === bill?.id) ?? null,
    [accountBills, bill],
  );

  const selectedCoverageTarget =
    settlementMode === 'all' ? totalAccountOutstanding : oldestOpenBill?.effective_open_balance ?? 0;
  const selectedDue = round2(selectedCoverageTarget);
  const roundedCashDue = getRoundedCashDue(selectedDue);
  const cashReceived = round2(Number.parseFloat(amount) || 0);
  const postedAmount = round2(
    Math.min(cashReceived, roundedCashDue > 0 ? roundedCashDue : cashReceived),
  );
  const changeToReturn = round2(Math.max(cashReceived - roundedCashDue, 0));
  const carryForwardCredit = round2(Math.max(postedAmount - selectedDue, 0));
  const remainingOnTarget = round2(Math.max(selectedDue - postedAmount, 0));
  const projectedAccountBalance = round2(totalAccountOutstanding - postedAmount);
  const allocationPreview = useMemo<AllocationPreviewRow[]>(() => {
    let remaining = postedAmount;

    return openBills.map((row) => {
      const applied = round2(Math.min(remaining, row.effective_open_balance));
      const remainingAfter = round2(Math.max(row.effective_open_balance - applied, 0));
      remaining = round2(Math.max(remaining - applied, 0));

      return {
        billId: row.id,
        periodLabel: billPeriod(row.period_start, row.period_end),
        dueDate: row.due_date,
        exactOpenBefore: row.effective_open_balance,
        applied,
        remainingAfter,
        localRemainingBalance: row.local_remaining_balance,
        totalForMonth: row.total_for_month,
        totalAmountDue: row.total_amount_due,
      };
    });
  }, [openBills, postedAmount]);
  const touchedBills = allocationPreview.filter((row) => row.applied > 0);
  const openBillCount = openBills.length;
  const modeLabel =
    settlementMode === 'all' ? 'Apply across all open dues' : 'Oldest due only';

  const quickCashButtons = useMemo(() => {
    if (selectedDue <= 0) {
      return [];
    }

    const base = roundedCashDue || selectedDue;
    const presets = [
      {
        label: settlementMode === 'all' ? 'Exact all open' : 'Exact oldest',
        value: selectedDue,
      },
      {
        label: settlementMode === 'all' ? 'Round all open' : 'Round oldest',
        value: roundedCashDue,
      },
      { label: '+ PHP 50', value: round2(base + 50) },
      { label: '+ PHP 100', value: round2(base + 100) },
    ];

    return presets.filter((item, index, list) => {
      if (item.value <= 0) {
        return false;
      }

      return list.findIndex((other) => other.value === item.value) === index;
    });
  }, [roundedCashDue, selectedDue, settlementMode]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!bill || !oldestOpenBill) {
      return;
    }

    if (postedAmount <= 0) {
      toast.error('Enter a valid cash amount.');
      return;
    }

    setSaving(true);
    try {
      const response = await invoke<PaymentResult>('record_payment', {
        payload: {
          bill_id: oldestOpenBill.id,
          amount_paid: postedAmount,
          period_start: oldestOpenBill.period_start,
          period_end: oldestOpenBill.period_end,
          payment_method: 'cash',
        },
      });

      toast.success(
        response.allocations_count > 1
          ? `Payment recorded across ${response.allocations_count} bills. Receipt #${response.receipt_number}`
          : `Payment recorded. Receipt #${response.receipt_number}`,
      );
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
    return <div className="p-8 text-sm text-gray-400">Loading cashier console...</div>;
  }

  if (!bill) {
    return <div className="p-8 text-sm text-red-500">Bill not found.</div>;
  }

  const noOpenObligation = !oldestOpenBill;
  const routeDiffersFromTarget = Boolean(
    requestedBill && oldestOpenBill && requestedBill.id !== oldestOpenBill.id,
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="rounded-lg p-1.5 transition-colors hover:bg-gray-100"
        >
          <ArrowLeft size={16} className="text-gray-500" />
        </button>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Cashier Payment Console</h2>
          <p className="text-sm text-gray-500">
            Post cash to the oldest open bill first so the account ledger stays consistent.
          </p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.18fr_0.94fr]">
        <div className="space-y-5">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xl font-semibold text-gray-900">{bill.resident_name}</p>
                <p className="mt-1 font-mono text-sm text-gray-500">
                  {bill.building_code}-{bill.unit_number} - {bill.account_number}
                </p>
                <p className="mt-2 text-xs uppercase tracking-[0.2em] text-gray-400">
                  Account Snapshot
                </p>
              </div>

              <div className="grid min-w-[240px] gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">
                    Open account balance
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-gray-900">
                    {php(totalAccountOutstanding)}
                  </p>
                </div>
                <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-green-700">
                    Oldest bill due now
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-green-800">
                    {php(selectedDue)}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-gray-200 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">
                  Clicked from bill
                </p>
                <p className="mt-2 text-sm font-medium text-gray-800">
                  {billPeriod(bill.period_start, bill.period_end)}
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Current month</p>
                <p className="mt-2 text-sm font-medium text-gray-800">
                  {php(bill.total_for_month)}
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Carry-forward</p>
                <p className="mt-2 text-sm font-medium text-gray-800">
                  {php(bill.previous_balance)}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Account obligations</h3>
                <p className="mt-1 text-sm text-gray-500">
                  One cashier action can cover one bill or the whole open account. The backend
                  still settles every monthly bill oldest-first.
                </p>
              </div>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">
                {accountBills.length} bills on record
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {accountBills.map((row) => {
                const isPayNow = row.is_oldest_open;
                const isSettled = row.effective_open_balance <= 0;

                return (
                  <div
                    key={row.id}
                    className={`rounded-2xl border px-4 py-4 transition-colors ${
                      isPayNow
                        ? 'border-blue-300 bg-blue-50'
                        : isSettled
                          ? 'border-gray-200 bg-gray-50'
                          : 'border-amber-200 bg-amber-50'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">
                          {billPeriod(row.period_start, row.period_end)}
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          Due {row.due_date ? formatDate(row.due_date) : 'not set'}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {isPayNow && (
                          <span className="rounded-full bg-blue-600 px-3 py-1 text-xs font-medium text-white">
                            Pay now
                          </span>
                        )}
                        {!isPayNow && !isSettled && (
                          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
                            Next after older dues
                          </span>
                        )}
                        {isSettled && (
                          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800">
                            Settled
                          </span>
                        )}
                        {!isSettled &&
                          (allocationPreview.find((preview) => preview.billId === row.id)
                            ?.applied ?? 0) > 0 && (
                            <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800">
                              Applying{' '}
                              {php(
                                allocationPreview.find((preview) => preview.billId === row.id)
                                  ?.applied ?? 0,
                              )}
                            </span>
                          )}
                      </div>
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-4">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-gray-500">
                          Monthly charge
                        </p>
                        <p className="mt-1 text-sm font-medium text-gray-800">
                          {php(row.total_for_month)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-gray-500">
                          Previous balance
                        </p>
                        <p className="mt-1 text-sm font-medium text-gray-800">
                          {php(row.previous_balance)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-gray-500">
                          Total bill
                        </p>
                        <p className="mt-1 text-sm font-medium text-gray-800">
                          {php(row.total_amount_due)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-gray-500">
                          Open obligation
                        </p>
                        <p
                          className={`mt-1 text-sm font-semibold ${
                            row.effective_open_balance > 0 ? 'text-red-600' : 'text-green-700'
                          }`}
                        >
                          {php(row.effective_open_balance)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-gray-900">Cash posting</h3>
              <p className="mt-1 text-sm text-gray-500">
                Choose whether this payment should stop at the oldest bill or continue across
                all open obligations. The system still allocates oldest-first.
              </p>
            </div>
            <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-right">
              <p className="text-xs uppercase tracking-wide text-green-700">Posting to</p>
              <p className="mt-1 text-sm font-semibold text-green-900">
                {settlementMode === 'all'
                  ? `${openBillCount} open bill${openBillCount === 1 ? '' : 's'}`
                  : oldestOpenBill
                    ? billPeriod(oldestOpenBill.period_start, oldestOpenBill.period_end)
                    : 'No open bill'}
              </p>
            </div>
          </div>

          {routeDiffersFromTarget && oldestOpenBill && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              The bill you opened is not the oldest open obligation. Posting still starts from{' '}
              {billPeriod(oldestOpenBill.period_start, oldestOpenBill.period_end)} first.
            </div>
          )}

          {noOpenObligation && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
              This account has no remaining open balance. Use Receipt Log if you need to review
              past payments or reprint receipts.
            </div>
          )}

          {!noOpenObligation && (
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSettlementMode('oldest');
                    setAmount(formatMoneyInput(getRoundedCashDue(oldestOpenBill?.effective_open_balance ?? 0)));
                  }}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    settlementMode === 'oldest'
                      ? 'bg-blue-600 text-white'
                      : 'border border-gray-300 bg-white text-gray-700 hover:border-blue-300 hover:text-blue-700'
                  }`}
                >
                  Oldest due only
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSettlementMode('all');
                    setAmount(formatMoneyInput(getRoundedCashDue(totalAccountOutstanding)));
                  }}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    settlementMode === 'all'
                      ? 'bg-blue-600 text-white'
                      : 'border border-gray-300 bg-white text-gray-700 hover:border-blue-300 hover:text-blue-700'
                  }`}
                  disabled={openBillCount <= 1}
                >
                  Apply across all open dues
                </button>
                <span className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600">
                  Active mode: {modeLabel}
                </span>
              </div>

              <p className="mt-3 text-xs text-gray-500">
                Use the all-open mode when the owner wants to settle several months in one cashier
                transaction. Use the oldest-only mode when they are only clearing the oldest bill.
              </p>
            </div>
          )}

          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Accepted method</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-green-300 bg-white px-4 py-3 shadow-sm">
                <div className="flex items-center gap-2 text-green-700">
                  <Banknote size={16} />
                  <span className="text-sm font-semibold">Cash</span>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  Active. Cash rounding can carry centavo credits forward.
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 opacity-60">
                <div className="flex items-center gap-2 text-gray-500">
                  <Smartphone size={16} />
                  <span className="text-sm font-semibold">GCash</span>
                </div>
                <p className="mt-2 text-xs text-gray-500">Coming soon.</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 opacity-60">
                <div className="flex items-center gap-2 text-gray-500">
                  <Landmark size={16} />
                  <span className="text-sm font-semibold">Bank Transfer</span>
                </div>
                <p className="mt-2 text-xs text-gray-500">Coming soon.</p>
              </div>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-gray-500">
              Cash received (PHP)
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="w-full rounded-2xl border border-gray-300 bg-white px-4 py-4 text-3xl font-semibold tracking-tight text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="0.00"
              required
              autoFocus
              disabled={noOpenObligation}
            />
            <p className="mt-2 text-xs text-gray-500">
              The system can stop at the oldest bill or continue across all open dues depending
              on the mode above. Whole-peso change can still be returned. Centavo rounding stays
              as account credit.
            </p>
          </div>

          {oldestOpenBill && quickCashButtons.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {quickCashButtons.map((button) => (
                <button
                  key={`${button.label}-${button.value}`}
                  type="button"
                  onClick={() => setAmount(formatMoneyInput(button.value))}
                  className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-blue-300 hover:text-blue-700"
                >
                  {button.label}: {php(button.value)}
                </button>
              ))}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-gray-200 px-4 py-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">Posted payment</p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{php(postedAmount)}</p>
              <p className="mt-1 text-xs text-gray-500">
                The amount that will actually be stored against the account.
              </p>
            </div>

            <div className="rounded-2xl border border-gray-200 px-4 py-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">Change to return</p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{php(changeToReturn)}</p>
              <p className="mt-1 text-xs text-gray-500">
                Whole-peso cash change based on the rounded settlement target.
              </p>
            </div>

            <div className="rounded-2xl border border-gray-200 px-4 py-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">
                Credit carried forward
              </p>
              <p className="mt-2 text-2xl font-semibold text-blue-700">
                {php(carryForwardCredit)}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Centavo credit that reduces the next bill for this account.
              </p>
            </div>

            <div className="rounded-2xl border border-gray-200 px-4 py-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">
                Account balance after post
              </p>
              <p
                className={`mt-2 text-2xl font-semibold ${
                  projectedAccountBalance > 0
                    ? 'text-red-600'
                    : projectedAccountBalance < 0
                      ? 'text-blue-700'
                      : 'text-green-700'
                }`}
              >
                {projectedAccountBalance < 0
                  ? `CR ${php(Math.abs(projectedAccountBalance))}`
                  : php(projectedAccountBalance)}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Negative values become carry-forward credit on the next bill.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Layers3 size={16} className="text-blue-600" />
                <div>
                  <p className="text-sm font-semibold text-gray-900">Allocation preview</p>
                  <p className="text-xs text-gray-500">
                    This is how the payment will be split across monthly bills after you post it.
                  </p>
                </div>
              </div>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">
                {touchedBills.length} bill{touchedBills.length === 1 ? '' : 's'} touched
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {openBills.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 px-4 py-5 text-center text-sm text-gray-400">
                  No open obligations to allocate.
                </div>
              ) : (
                allocationPreview.map((row, index) => {
                  const isTouched = row.applied > 0;
                  const isSettledAfterPost = row.remainingAfter <= 0 && row.applied > 0;

                  return (
                    <div
                      key={row.billId}
                      className={`rounded-xl border px-4 py-3 ${
                        isTouched
                          ? 'border-green-200 bg-green-50'
                          : 'border-gray-200 bg-gray-50'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{row.periodLabel}</p>
                          <p className="mt-1 text-xs text-gray-500">
                            Due {row.dueDate ? formatDate(row.dueDate) : 'not set'}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {index === 0 && (
                            <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-800">
                              Oldest open
                            </span>
                          )}
                          {!isTouched && (
                            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
                              Waiting
                            </span>
                          )}
                          {isTouched && !isSettledAfterPost && (
                            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
                              Partial after post
                            </span>
                          )}
                          {isSettledAfterPost && (
                            <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800">
                              Settled in this post
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 grid gap-3 sm:grid-cols-4">
                        <div>
                          <p className="text-xs uppercase tracking-wide text-gray-500">
                            Open before
                          </p>
                          <p className="mt-1 text-sm font-semibold text-red-600">
                            {php(row.exactOpenBefore)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-gray-500">
                            Applied now
                          </p>
                          <p className="mt-1 text-sm font-semibold text-green-700">
                            {php(row.applied)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-gray-500">
                            Remaining after
                          </p>
                          <p
                            className={`mt-1 text-sm font-semibold ${
                              row.remainingAfter > 0 ? 'text-amber-700' : 'text-green-700'
                            }`}
                          >
                            {php(row.remainingAfter)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-gray-500">
                            Bill total
                          </p>
                          <p className="mt-1 text-sm font-medium text-gray-800">
                            {php(row.totalAmountDue)}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-gray-600">
                {settlementMode === 'all' ? 'All open dues' : 'Oldest bill due now'}
              </span>
              <strong className="text-gray-900">{php(selectedDue)}</strong>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-sm">
              <span className="text-gray-600">
                {settlementMode === 'all' ? 'Remaining after this cashier post' : 'Remaining on oldest bill'}
              </span>
              <strong
                className={remainingOnTarget > 0 ? 'text-amber-700' : 'text-green-700'}
              >
                {php(remainingOnTarget)}
              </strong>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-sm">
              <span className="text-gray-600">Rounded cash settlement</span>
              <strong className="text-gray-900">{php(roundedCashDue)}</strong>
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-600 transition-colors hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || postedAmount <= 0 || noOpenObligation}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <CreditCard size={16} />
              {saving ? 'Posting cash...' : 'Post Cash Payment & Print Receipt'}
            </button>
          </div>

          <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-900">
            <div className="flex items-start gap-2">
              <Receipt size={14} className="mt-0.5 shrink-0" />
              <p>
                After posting, the receipt will reflect the updated account balance. If the
                cash settlement rounds the centavos up, the excess stays as a credit for the
                next cycle instead of being lost.
              </p>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
