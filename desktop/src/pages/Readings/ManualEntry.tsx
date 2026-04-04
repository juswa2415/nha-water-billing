import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Keyboard, RefreshCcw, TriangleAlert, Upload } from 'lucide-react';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { cubicM, formatDate } from '../../utils/formatters';

interface ReadingRow {
  id: number;
  unit_id: number;
  unit_number: string;
  building_code: string;
  building_name: string;
  floor_number: number;
  resident_name: string | null;
  meter_number: string | null;
  billing_cycle_id: number;
  previous_reading: number;
  current_reading: number | null;
  consumption: number | null;
  status: string;
  flag_reason: string | null;
  notes: string | null;
  read_at: string | null;
  source: string;
  submitted_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
}

interface CycleInfo {
  id: number;
  period_start: string;
  period_end: string;
  status: string;
  total_units: number;
  readings_submitted: number;
  readings_approved: number;
}

const STATUS_FILTERS = [
  { key: 'pending', label: 'Needs Entry' },
  { key: 'submitted', label: 'Entered' },
  { key: 'flagged', label: 'Flagged' },
  { key: 'approved', label: 'Approved' },
  { key: 'all', label: 'All' },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]['key'];

function formatEditableNumber(value: number | null) {
  if (value == null) {
    return '';
  }

  return Number.isInteger(value) ? value.toString() : value.toFixed(2).replace(/\.?0+$/, '');
}

function matchesStatusFilter(row: ReadingRow, statusFilter: StatusFilter) {
  if (statusFilter === 'all') {
    return true;
  }
  return row.status === statusFilter;
}

export function ManualEntry() {
  const navigate = useNavigate();
  const { cycleId } = useParams<{ cycleId: string }>();
  const [searchParams] = useSearchParams();
  const cycleIdNumber = Number(cycleId);
  const focusRowId = Number(searchParams.get('focus') ?? 'NaN');

  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const hasAppliedFocusRef = useRef(false);

  const [cycle, setCycle] = useState<CycleInfo | null>(null);
  const [rows, setRows] = useState<ReadingRow[]>([]);
  const [draftValues, setDraftValues] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingRowId, setSavingRowId] = useState<number | null>(null);
  const [buildingFilter, setBuildingFilter] = useState('all');
  const [floorFilter, setFloorFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [search, setSearch] = useState('');
  const [activeRowId, setActiveRowId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [cycles, readingRows] = await Promise.all([
        invoke<CycleInfo[]>('list_billing_cycles'),
        invoke<ReadingRow[]>('list_readings_for_cycle', {
          cycleId: cycleIdNumber,
          statusFilter: null,
        }),
      ]);

      const matchedCycle = cycles.find((item) => item.id === cycleIdNumber) ?? null;
      if (!matchedCycle) {
        toast.error('Billing cycle not found.');
        navigate('/readings', { replace: true });
        return;
      }

      setCycle(matchedCycle);
      setRows(readingRows);
      setDraftValues(
        Object.fromEntries(
          readingRows.map((row) => [row.id, formatEditableNumber(row.current_reading)]),
        ),
      );
    } catch (error: any) {
      toast.error(error.toString());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!Number.isFinite(cycleIdNumber)) {
      navigate('/readings', { replace: true });
      return;
    }

    void load();
  }, [cycleIdNumber]);

  const cycleReadOnly = ['billing', 'finalized', 'locked'].includes(cycle?.status ?? '');

  const buildingOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.building_code))).sort(),
    [rows],
  );

  const floorOptions = useMemo(() => {
    const scopedRows = buildingFilter === 'all'
      ? rows
      : rows.filter((row) => row.building_code === buildingFilter);

    return Array.from(new Set(scopedRows.map((row) => row.floor_number))).sort((a, b) => a - b);
  }, [rows, buildingFilter]);

  const counts = useMemo(() => rows.reduce(
    (acc, row) => {
      acc.total += 1;
      acc[row.status as keyof typeof acc] = (acc[row.status as keyof typeof acc] ?? 0) + 1;
      return acc;
    },
    {
      total: 0,
      pending: 0,
      submitted: 0,
      flagged: 0,
      approved: 0,
      skipped: 0,
    },
  ), [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (!matchesStatusFilter(row, statusFilter)) {
        return false;
      }

      if (buildingFilter !== 'all' && row.building_code !== buildingFilter) {
        return false;
      }

      if (floorFilter !== 'all' && row.floor_number !== Number(floorFilter)) {
        return false;
      }

      if (!search) {
        return true;
      }

      const haystack = [
        row.building_code,
        row.building_name,
        row.unit_number,
        row.resident_name ?? '',
        row.meter_number ?? '',
      ].join(' ').toLowerCase();

      return haystack.includes(search.toLowerCase());
    });
  }, [rows, statusFilter, buildingFilter, floorFilter, search]);

  const focusRowInput = (rowId: number | null) => {
    if (!rowId) {
      return;
    }

    window.setTimeout(() => {
      const input = inputRefs.current[rowId];
      input?.focus();
      input?.select();
      setActiveRowId(rowId);
    }, 40);
  };

  useEffect(() => {
    if (hasAppliedFocusRef.current || !Number.isFinite(focusRowId) || !rows.length) {
      return;
    }

    const targetRow = rows.find((row) => row.id === focusRowId);
    if (!targetRow) {
      return;
    }

    hasAppliedFocusRef.current = true;
    setStatusFilter('all');
    setBuildingFilter(targetRow.building_code);
    setFloorFilter(targetRow.floor_number.toString());
    focusRowInput(targetRow.id);
  }, [focusRowId, rows]);

  const saveRow = async (row: ReadingRow, nextRowId?: number | null) => {
    const currentInput = draftValues[row.id]?.trim() ?? '';
    const currentReading = Number(currentInput);

    if (!currentInput || !Number.isFinite(currentReading)) {
      toast.error(`Enter a valid current reading for ${row.building_code}-${row.unit_number}.`);
      focusRowInput(row.id);
      return;
    }

    setSavingRowId(row.id);
    try {
      const updatedRow = await invoke<ReadingRow>('manual_entry_reading', {
        payload: {
          unit_id: row.unit_id,
          billing_cycle_id: row.billing_cycle_id,
          previous_reading: row.previous_reading,
          current_reading: currentReading,
          notes: row.notes,
        },
      });

      setRows((prev) => prev.map((item) => (
        item.id === row.id || item.unit_id === row.unit_id ? updatedRow : item
      )));
      setDraftValues((prev) => ({
        ...prev,
        [row.id]: formatEditableNumber(updatedRow.current_reading),
      }));

      if (updatedRow.status === 'flagged') {
        toast.error(`${updatedRow.building_code}-${updatedRow.unit_number} was flagged for review.`);
      }

      if (nextRowId) {
        focusRowInput(nextRowId);
      }
    } catch (error: any) {
      toast.error(error.toString());
      focusRowInput(row.id);
    } finally {
      setSavingRowId(null);
    }
  };

  const handleEnter = async (
    event: React.KeyboardEvent<HTMLInputElement>,
    row: ReadingRow,
    index: number,
  ) => {
    if (event.key !== 'Enter') {
      return;
    }

    event.preventDefault();
    const nextRowId = event.shiftKey ? null : filteredRows[index + 1]?.id ?? null;
    await saveRow(row, nextRowId);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => navigate('/readings')}
            className="rounded-lg p-1.5 transition-colors hover:bg-gray-100"
          >
            <ArrowLeft size={16} className="text-gray-500" />
          </button>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Manual Meter Encoding</h2>
            {cycle && (
              <p className="mt-1 text-sm text-gray-500">
                Cycle #{cycle.id} · {formatDate(cycle.period_start)} to {formatDate(cycle.period_end)}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => navigate(`/readings/review/${cycleIdNumber}`)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
          >
            Review Exceptions
          </button>
          <button
            type="button"
            onClick={() => navigate('/readings/sync')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
          >
            <Upload size={14} />
            Mobile Sync
          </button>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
          >
            <RefreshCcw size={14} />
            Refresh
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <h3 className="text-sm font-semibold text-blue-950">Keyboard-first desktop encoding</h3>
            <p className="mt-2 text-sm leading-6 text-blue-900">
              This screen is designed for continuous manual entry when the field app is unavailable.
              Filter the cycle by building or floor, keep your hands on the keyboard, and press
              Enter to save the current reading and jump to the next row.
            </p>
          </div>
          <div className="rounded-xl border border-blue-200 bg-white px-4 py-3 text-xs text-blue-900">
            <p className="inline-flex items-center gap-1.5 font-medium">
              <Keyboard size={14} />
              Shortcuts
            </p>
            <p className="mt-2">`Enter` saves and moves to the next row.</p>
            <p className="mt-1">`Shift + Enter` saves and stays on the same row.</p>
          </div>
        </div>
      </div>

      {cycleReadOnly && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This billing cycle is already in a protected stage. Manual entry is now view-only.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Needs Entry</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">{counts.pending}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Entered</p>
          <p className="mt-2 text-2xl font-semibold text-blue-700">{counts.submitted}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Flagged</p>
          <p className="mt-2 text-2xl font-semibold text-orange-700">{counts.flagged}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Approved</p>
          <p className="mt-2 text-2xl font-semibold text-green-700">{counts.approved}</p>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr_0.8fr_1fr]">
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search building, unit, resident, or meter..."
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={buildingFilter}
            onChange={(event) => {
              setBuildingFilter(event.target.value);
              setFloorFilter('all');
            }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Buildings</option>
            {buildingOptions.map((buildingCode) => (
              <option key={buildingCode} value={buildingCode}>
                {buildingCode}
              </option>
            ))}
          </select>
          <select
            value={floorFilter}
            onChange={(event) => setFloorFilter(event.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Floors</option>
            {floorOptions.map((floorNumber) => (
              <option key={floorNumber} value={floorNumber}>
                Floor {floorNumber}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setStatusFilter(item.key)}
                className={`rounded-full border px-3 py-2 text-xs transition-colors ${
                  statusFilter === item.key
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <p className="mt-3 text-xs text-gray-500">
          Showing {filteredRows.length} of {rows.length} units in this cycle.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Unit</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Resident</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Meter</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Previous</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Current Input</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Consumption</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Review Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center text-sm text-gray-400">
                    Loading encoding rows...
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center text-sm text-gray-400">
                    No units match the current filters.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row, index) => {
                  const draftValue = draftValues[row.id] ?? '';
                  const parsedDraft = Number(draftValue);
                  const previewConsumption = Number.isFinite(parsedDraft)
                    ? parsedDraft - row.previous_reading
                    : row.consumption;
                  const rowIsActive = activeRowId === row.id;
                  const rowIsFlagged = row.status === 'flagged';

                  return (
                    <tr
                      key={row.id}
                      className={`transition-colors ${
                        rowIsActive ? 'bg-blue-50/60' : rowIsFlagged ? 'bg-orange-50/60' : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className="px-4 py-3 align-top">
                        <p className="font-mono text-xs font-semibold text-gray-900">
                          {row.building_code}-{row.floor_number}-{row.unit_number}
                        </p>
                        <p className="mt-1 text-xs text-gray-500">{row.building_name}</p>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <p className="text-sm font-medium text-gray-900">
                          {row.resident_name ?? 'No resident account'}
                        </p>
                        {row.submitted_by && (
                          <p className="mt-1 text-xs text-gray-500">
                            Last encoded by {row.submitted_by}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <p className="font-mono text-xs text-gray-600">{row.meter_number ?? '-'}</p>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <p className="font-mono text-sm text-gray-900">{row.previous_reading.toFixed(2)}</p>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-center gap-2">
                          <input
                            ref={(element) => {
                              inputRefs.current[row.id] = element;
                            }}
                            type="number"
                            step="0.01"
                            value={draftValue}
                            disabled={cycleReadOnly}
                            onFocus={(event) => {
                              setActiveRowId(row.id);
                              event.currentTarget.select();
                            }}
                            onChange={(event) => setDraftValues((prev) => ({
                              ...prev,
                              [row.id]: event.target.value,
                            }))}
                            onKeyDown={(event) => void handleEnter(event, row, index)}
                            className="w-36 rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
                          />
                          <button
                            type="button"
                            onClick={() => void saveRow(row, filteredRows[index + 1]?.id ?? null)}
                            disabled={cycleReadOnly || savingRowId === row.id}
                            className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60"
                          >
                            {savingRowId === row.id ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <p className={`font-mono text-sm ${
                          previewConsumption != null && previewConsumption < 0
                            ? 'text-red-600'
                            : 'text-gray-900'
                        }`}>
                          {previewConsumption != null && Number.isFinite(previewConsumption)
                            ? cubicM(previewConsumption)
                            : '-'}
                        </p>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <StatusBadge status={row.status} />
                        {row.read_at && (
                          <p className="mt-2 text-xs text-gray-500">
                            {new Date(row.read_at).toLocaleString('en-PH', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        {row.flag_reason ? (
                          <p className="inline-flex items-start gap-1 text-xs text-orange-700">
                            <TriangleAlert size={12} className="mt-0.5 shrink-0" />
                            <span>{row.flag_reason}</span>
                          </p>
                        ) : (
                          <span className="text-xs text-gray-400">No review note</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
