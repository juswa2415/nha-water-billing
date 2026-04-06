import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Droplets, FileText, Printer, Receipt, Trash2, X, Zap } from 'lucide-react';
import { ConfirmDialog } from '../../components/shared/ConfirmDialog';
import { DataTable, type Column } from '../../components/shared/DataTable';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { cubicM, php } from '../../utils/formatters';
import { useAuthStore } from '../../store/authStore';
import { printHtmlDocument } from '../../services/printService';
import {
  getBillPrintStyles,
  renderBillPrintHtml,
  type PrintableBill,
} from './billPrintTemplate';

interface BillRow {
  id: number;
  account_number: string;
  resident_name: string;
  unit_number: string;
  building_code: string;
  period_start: string;
  period_end: string;
  consumption_cubicm: number;
  water_charge: number;
  sys_loss_charge: number;
  common_sys_loss: number;
  previous_balance: number;
  total_for_month: number;
  total_amount_due: number;
  status: string;
  total_paid: number;
  remaining_balance: number;
  payments_count: number;
  latest_payment_id: number | null;
  latest_receipt_number: string | null;
  latest_payment_date: string | null;
}

interface GenResult {
  bills_generated: number;
  skipped: number;
  errors: string[];
}

interface CycleRow {
  id: number;
  period_start: string;
  period_end: string;
  status: string;
  maynilad_prev: number | null;
  maynilad_curr: number | null;
  total_active_units_camres: number | null;
}

interface LossInputRow {
  building_id: number;
  building_code: string;
  building_name: string;
  sub_meter_number: string | null;
  previous_reading: number | null;
  current_reading: number | null;
  total_consumption: number | null;
}

const BILL_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Open' },
  { value: 'finalized', label: 'Settled' },
] as const;

const PAGE_SIZE = 20;

const BILL_STATUS_LABELS: Record<string, string> = {
  draft: 'Open',
  finalized: 'Settled',
  locked: 'Closed',
};

const CYCLE_STAGE_META: Record<string, { label: string; help: string }> = {
  draft: {
    label: 'Setup',
    help: 'The cycle exists, but meter reading work has not been opened yet.',
  },
  reading_phase: {
    label: 'Reading In Progress',
    help: 'Field readings are still being collected from the mobile app or entered manually.',
  },
  review_phase: {
    label: 'Review Readings',
    help: 'Readings can still be checked, corrected, and then turned into bills.',
  },
  billing: {
    label: 'Prepare Bills',
    help: 'Bills can still be generated again from the approved readings before the cycle is issued.',
  },
  finalized: {
    label: 'Bills Issued',
    help: 'The cycle has already been issued to residents. Bills should no longer be rebuilt casually.',
  },
  locked: {
    label: 'Closed',
    help: 'The cycle is closed for audit and recordkeeping. No more bill rebuilding is allowed.',
  },
};

export function BillGenerate() {
  const { cycleId } = useParams<{ cycleId: string }>();
  const navigate = useNavigate();
  const { hasRole } = useAuthStore();
  const [bills, setBills] = useState<BillRow[]>([]);
  const [cycle, setCycle] = useState<CycleRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmGen, setConfirmGen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [result, setResult] = useState<GenResult | null>(null);
  const [statusFilter, setStatusFilter] =
    useState<(typeof BILL_FILTERS)[number]['value']>('all');
  const [search, setSearch] = useState('');
  const [showLossInputs, setShowLossInputs] = useState(false);
  const [lossRows, setLossRows] = useState<LossInputRow[]>([]);
  const [savingLossInputs, setSavingLossInputs] = useState(false);
  const [mayniladPrev, setMayniladPrev] = useState('');
  const [mayniladCurr, setMayniladCurr] = useState('');
  const [activeUnitsCamres, setActiveUnitsCamres] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const loadBills = () => {
    if (!cycleId) {
      return;
    }

    setLoading(true);
    invoke<BillRow[]>('list_bills_for_cycle', {
      cycleId: Number(cycleId),
      statusFilter: statusFilter === 'all' ? null : statusFilter,
    })
      .then((rows) => setBills(rows))
      .finally(() => setLoading(false));
  };

  const loadCycle = () => {
    if (!cycleId) {
      return;
    }

    invoke<CycleRow[]>('list_billing_cycles')
      .then((rows) => {
        const match = rows.find((row) => row.id === Number(cycleId)) ?? null;
        setCycle(match);
        setMayniladPrev(match?.maynilad_prev != null ? String(match.maynilad_prev) : '');
        setMayniladCurr(match?.maynilad_curr != null ? String(match.maynilad_curr) : '');
        setActiveUnitsCamres(
          match?.total_active_units_camres != null
            ? String(match.total_active_units_camres)
            : '',
        );
      })
      .catch(() => setCycle(null));
  };

  useEffect(() => {
    loadBills();
    loadCycle();
  }, [cycleId, statusFilter]);

  useEffect(() => {
    setCurrentPage(1);
  }, [cycleId, statusFilter, search]);

  const generate = async () => {
    if (!cycleId) {
      return;
    }

    setGenerating(true);
    setConfirmGen(false);

    try {
      const response = await invoke<GenResult>('generate_bills_for_cycle', {
        cycleId: Number(cycleId),
      });
      setResult(response);
      toast.success(`${response.bills_generated} bills generated.`);
      loadBills();
      loadCycle();
    } catch (error) {
      toast.error(String(error));
    } finally {
      setGenerating(false);
    }
  };

  const handleBatchPrint = async () => {
    if (filteredBills.length === 0) {
      toast.error('There are no bills in the current view to print.');
      return;
    }

    setPrinting(true);
    try {
      const printableBills = await Promise.all(
        filteredBills.map((bill) =>
          invoke<PrintableBill>('get_bill', {
            billId: bill.id,
          }),
        ),
      );

      printHtmlDocument({
        title: `NHA Water Bills - Cycle ${cycleId}`,
        html: renderBillPrintHtml(printableBills),
        styles: getBillPrintStyles(),
      });
    } catch (error) {
      toast.error(String(error));
    } finally {
      setPrinting(false);
    }
  };

  const deleteCycle = async () => {
    if (!cycleId) {
      return;
    }

    setDeleting(true);
    try {
      await invoke('delete_billing_cycle', { cycleId: Number(cycleId) });
      toast.success('Billing cycle deleted.');
      navigate('/billing');
    } catch (error) {
      toast.error(String(error));
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const openLossInputs = async () => {
    if (!cycleId) {
      return;
    }

    try {
      const rows = await invoke<LossInputRow[]>('list_bldg_sub_readings_for_cycle', {
        cycleId: Number(cycleId),
      });
      setLossRows(rows);
      setShowLossInputs(true);
    } catch (error) {
      toast.error(String(error));
    }
  };

  const updateLossRow = (
    buildingId: number,
    field: 'previous_reading' | 'current_reading',
    value: string,
  ) => {
    setLossRows((current) =>
      current.map((row) =>
        row.building_id === buildingId
          ? {
              ...row,
              [field]: value === '' ? null : Number(value),
            }
          : row,
      ),
    );
  };

  const saveLossInputs = async () => {
    if (!cycle) {
      return;
    }

    const editableStatuses = ['draft', 'reading_phase', 'review_phase', 'billing'];
    if (!editableStatuses.includes(cycle.status)) {
      toast.error('Loss inputs can only be changed before bills are issued or the cycle is closed.');
      return;
    }

    const invalidBuilding = lossRows.find(
      (row) =>
        (row.previous_reading != null && !Number.isFinite(row.previous_reading)) ||
        (row.current_reading != null && !Number.isFinite(row.current_reading)),
    );

    if (invalidBuilding) {
      toast.error(`Enter valid readings for ${invalidBuilding.building_code}.`);
      return;
    }

    setSavingLossInputs(true);
    try {
      for (const row of lossRows) {
        if (row.previous_reading == null || row.current_reading == null) {
          continue;
        }

        await invoke('set_bldg_sub_reading', {
          payload: {
            building_id: row.building_id,
            billing_cycle_id: cycle.id,
            previous_reading: row.previous_reading,
            current_reading: row.current_reading,
          },
        });
      }

      toast.success('Loss inputs saved.');
      setShowLossInputs(false);
      loadCycle();
    } catch (error) {
      toast.error(String(error));
    } finally {
      setSavingLossInputs(false);
    }
  };

  const filteredBills = useMemo(() => {
    if (!search.trim()) {
      return bills;
    }

    const term = search.toLowerCase();
    return bills.filter((bill) =>
      bill.unit_number.toLowerCase().includes(term) ||
      bill.resident_name.toLowerCase().includes(term) ||
      bill.account_number.toLowerCase().includes(term) ||
      bill.building_code.toLowerCase().includes(term) ||
      (bill.latest_receipt_number ?? '').toLowerCase().includes(term),
    );
  }, [bills, search]);

  const totalPages = Math.max(1, Math.ceil(filteredBills.length / PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStart = filteredBills.length === 0 ? 0 : (safeCurrentPage - 1) * PAGE_SIZE;
  const paginatedBills = filteredBills.slice(pageStart, pageStart + PAGE_SIZE);
  const pageEnd = Math.min(pageStart + PAGE_SIZE, filteredBills.length);

  const totalDue = bills.reduce((sum, bill) => sum + bill.total_amount_due, 0);
  const cycleMeta = cycle ? CYCLE_STAGE_META[cycle.status] : null;
  const canGenerate = cycle ? ['review_phase', 'billing'].includes(cycle.status) : true;
  const generateLabel = bills.length > 0 ? 'Rebuild Draft Bills' : 'Generate Bills';
  const canEditLossInputs = cycle
    ? ['draft', 'reading_phase', 'review_phase', 'billing'].includes(cycle.status)
    : false;

  const columns: Column<BillRow>[] = [
    {
      key: 'account',
      header: 'Account',
      render: (bill) => (
        <div>
          <p className="text-xs font-medium text-gray-800">{bill.resident_name}</p>
          <p className="font-mono text-xs text-gray-400">
            {bill.building_code}-{bill.unit_number}
          </p>
        </div>
      ),
    },
    {
      key: 'consumption',
      header: 'Consumption',
      width: '110px',
      render: (bill) => (
        <span className="font-mono text-xs text-gray-600">
          {cubicM(bill.consumption_cubicm)}
        </span>
      ),
    },
    {
      key: 'water',
      header: 'Water',
      width: '95px',
      render: (bill) => <span className="text-xs">{php(bill.water_charge)}</span>,
    },
    {
      key: 'losses',
      header: 'Losses',
      width: '120px',
      render: (bill) => (
        <div className="text-xs text-gray-500">
          <div>{php(bill.sys_loss_charge)} bldg</div>
          <div>{php(bill.common_sys_loss)} common</div>
        </div>
      ),
    },
    {
      key: 'prev',
      header: 'Prev Bal',
      width: '90px',
      render: (bill) =>
        bill.previous_balance > 0 ? (
          <span className="text-xs text-red-500">{php(bill.previous_balance)}</span>
        ) : (
          <span className="text-xs text-gray-300">-</span>
        ),
    },
    {
      key: 'total',
      header: 'Total Due',
      width: '105px',
      render: (bill) => (
        <span className="text-sm font-semibold">{php(bill.total_amount_due)}</span>
      ),
    },
    {
      key: 'payment',
      header: 'Receipt / Payment',
      width: '190px',
      render: (bill) => {
        if (!bill.latest_payment_id || !bill.latest_receipt_number) {
          return (
            <div className="text-xs text-gray-400">
              <div>No receipt yet</div>
              <div>{bill.total_paid > 0 ? `Collected ${php(bill.total_paid)}` : 'Unpaid'}</div>
            </div>
          );
        }

        return (
          <div className="space-y-1">
            <button
              onClick={(event) => {
                event.stopPropagation();
                navigate(`/payments/receipt/${bill.latest_payment_id}`);
              }}
              className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800"
            >
              <Receipt size={12} />
              Receipt #{bill.latest_receipt_number}
            </button>
            <div className="text-xs text-gray-500">
              Payment ID {bill.latest_payment_id}
            </div>
            <div className="text-xs text-gray-400">
              {bill.payments_count} payment{bill.payments_count === 1 ? '' : 's'}
            </div>
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Bill Doc',
      width: '105px',
      render: (bill) => (
        <StatusBadge
          status={bill.status}
          label={BILL_STATUS_LABELS[bill.status] ?? bill.status.replace(/_/g, ' ')}
        />
      ),
    },
    {
      key: 'view',
      header: '',
      width: '70px',
      render: (bill) => (
        <button
          onClick={(event) => {
            event.stopPropagation();
            navigate(`/billing/bill/${bill.id}`);
          }}
          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
        >
          <FileText size={12} />
          View
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/billing')}
            className="rounded-lg p-1.5 transition-colors hover:bg-gray-100"
          >
            <ArrowLeft size={16} className="text-gray-500" />
          </button>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Bills - Cycle #{cycleId}</h2>
            {bills.length > 0 && (
              <p className="text-xs text-gray-500">
                {bills.length} bills - Total due: {php(totalDue)}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-44 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {BILL_FILTERS.map((filter) => (
            <button
              key={filter.value}
              onClick={() => setStatusFilter(filter.value)}
              className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                statusFilter === filter.value
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-gray-300 bg-white text-gray-500'
              }`}
            >
              {filter.label}
            </button>
          ))}
          {filteredBills.length > 0 && (
            <button
              onClick={() => void handleBatchPrint()}
              disabled={printing}
              className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-60"
            >
              <Printer size={14} />
              {printing ? 'Preparing print...' : 'Batch Print Bills'}
            </button>
          )}
          <button
            onClick={() => void openLossInputs()}
            className="flex items-center gap-1.5 rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-2 text-sm font-medium text-cyan-700 transition-colors hover:bg-cyan-100"
          >
            <Droplets size={14} />
            Loss Inputs
          </button>
          {hasRole('admin') && (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={deleting}
              className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-60"
            >
              <Trash2 size={14} />
              Delete Cycle
            </button>
          )}
          <button
            onClick={() => setConfirmGen(true)}
            disabled={generating || !canGenerate}
            className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Zap size={14} />
            {generating ? 'Working...' : generateLabel}
          </button>
        </div>
      </div>

      {cycleMeta && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-blue-900">Cycle stage</p>
            <StatusBadge status={cycle?.status ?? 'draft'} label={cycleMeta.label} />
          </div>
          <p className="mt-2 text-sm text-blue-900">{cycleMeta.help}</p>
          {!canGenerate && (
            <p className="mt-2 text-xs text-blue-800">
              Draft bill rebuilding is only allowed while the cycle is in Review Readings
              or Prepare Bills. This cycle is already {cycleMeta.label.toLowerCase()}.
            </p>
          )}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-xs text-gray-500">
        This table shows all bills inside the selected cycle. It includes open, partially paid,
        and settled accounts, not just unpaid ones. Billing owns bill generation, batch printing,
        and closure. Payments are posted only from Payment Queue.
      </div>

      {result && (
        <div
          className={`rounded-xl border p-4 text-sm ${
            result.errors.length
              ? 'border-orange-200 bg-orange-50 text-orange-800'
              : 'border-green-200 bg-green-50 text-green-800'
          }`}
        >
          {result.bills_generated} bills generated - {result.skipped} skipped
          {result.errors.map((error, index) => (
            <div key={index} className="mt-1 font-mono text-xs">
              {error}
            </div>
          ))}
        </div>
      )}

      <DataTable
        columns={columns}
        data={paginatedBills}
        rowKey={(bill) => bill.id}
        loading={loading}
        onRowClick={(bill) => navigate(`/billing/bill/${bill.id}`)}
        emptyMessage="No bills yet. Generate bills after the cycle readings have been approved."
      />

      {filteredBills.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-xs text-gray-600">
          <p>
            Showing {pageStart + 1}-{pageEnd} of {filteredBills.length} bills.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={safeCurrentPage === 1}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Previous
            </button>
            <span>
              Page {safeCurrentPage} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              disabled={safeCurrentPage === totalPages}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmGen}
        title={bills.length > 0 ? 'Rebuild draft bills?' : 'Generate bills?'}
        message={
          bills.length > 0
            ? 'This recalculates open draft bills from the approved readings in this cycle. Paid receipts and closed records stay untouched.'
            : 'This creates bills for all approved readings in this cycle.'
        }
        confirmLabel="Continue"
        onConfirm={generate}
        onCancel={() => setConfirmGen(false)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this billing cycle?"
        message="Only the latest cycle can be deleted. This removes the cycle, its readings, bills, and any payments posted inside it. Use this carefully during development or only with proper admin verification."
        confirmLabel={deleting ? 'Deleting...' : 'Delete cycle'}
        danger
        onConfirm={deleteCycle}
        onCancel={() => setConfirmDelete(false)}
      />

      {showLossInputs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowLossInputs(false)} />
          <div className="relative mx-4 w-full max-w-5xl rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Loss input readings</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Use this for building sub-meter readings and the Maynilad/common-loss values used in bill generation.
                </p>
                {!canEditLossInputs && (
                  <p className="mt-2 text-xs text-amber-700">
                    This cycle is already issued or closed, so these values are now view-only.
                  </p>
                )}
              </div>
              <button
                onClick={() => setShowLossInputs(false)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-blue-700">
                Cycle-level common-loss reference
              </p>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-blue-100 bg-white p-3">
                  <p className="text-xs text-gray-500">Maynilad previous reading</p>
                  <p className="mt-1 text-lg font-semibold text-gray-900">
                    {mayniladPrev === '' ? '-' : mayniladPrev}
                  </p>
                </div>
                <div className="rounded-xl border border-blue-100 bg-white p-3">
                  <p className="text-xs text-gray-500">Maynilad current reading</p>
                  <p className="mt-1 text-lg font-semibold text-gray-900">
                    {mayniladCurr === '' ? '-' : mayniladCurr}
                  </p>
                </div>
                <div className="rounded-xl border border-blue-100 bg-white p-3">
                  <p className="text-xs text-gray-500">Active units snapshot in CamRes</p>
                  <p className="mt-1 text-lg font-semibold text-gray-900">
                    {activeUnitsCamres === '' ? '-' : activeUnitsCamres}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-xs text-blue-800">
                These values come from the cycle record and are used for the CamRes-wide common
                system loss computation. Only the building sub-meter readings below are edited here.
              </p>
            </div>

            <div className="mt-5 rounded-xl border border-gray-200">
              <div className="grid grid-cols-[1.2fr_1.1fr_1fr_1fr_110px] gap-3 border-b border-gray-100 bg-gray-50 px-4 py-3 text-xs font-medium uppercase tracking-wide text-gray-500">
                <span>Building</span>
                <span>Sub-meter</span>
                <span>Previous</span>
                <span>Current</span>
                <span>Consumption</span>
              </div>
              <div className="max-h-[380px] overflow-y-auto divide-y divide-gray-100">
                {lossRows.map((row) => (
                  <div
                    key={row.building_id}
                    className="grid grid-cols-[1.2fr_1.1fr_1fr_1fr_110px] gap-3 px-4 py-3 text-sm"
                  >
                    <div>
                      <p className="font-medium text-gray-900">{row.building_code}</p>
                      <p className="text-xs text-gray-500">{row.building_name}</p>
                    </div>
                    <div className="text-xs text-gray-500">
                      {row.sub_meter_number ?? 'No sub-meter no.'}
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      value={row.previous_reading ?? ''}
                      onChange={(event) =>
                        updateLossRow(row.building_id, 'previous_reading', event.target.value)
                      }
                      disabled={!canEditLossInputs}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={row.current_reading ?? ''}
                      onChange={(event) =>
                        updateLossRow(row.building_id, 'current_reading', event.target.value)
                      }
                      disabled={!canEditLossInputs}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                    />
                    <div className="text-sm font-medium text-gray-700">
                      {row.current_reading != null && row.previous_reading != null
                        ? cubicM(Math.max(row.current_reading - row.previous_reading, 0))
                        : row.total_consumption != null
                          ? cubicM(row.total_consumption)
                          : '-'}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowLossInputs(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => void saveLossInputs()}
                disabled={!canEditLossInputs || savingLossInputs}
                className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-60"
              >
                {savingLossInputs ? 'Saving...' : 'Save loss inputs'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
