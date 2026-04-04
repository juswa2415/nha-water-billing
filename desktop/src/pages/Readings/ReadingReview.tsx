import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, CheckCircle2, PencilLine, TriangleAlert, Upload } from 'lucide-react';
import { DataTable, type Column } from '../../components/shared/DataTable';
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
}

const REVIEW_FILTERS = [
  { key: 'needs_review', label: 'Needs Review' },
  { key: 'flagged', label: 'Flagged' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'approved', label: 'Approved' },
  { key: 'all', label: 'All' },
] as const;

type ReviewFilter = (typeof REVIEW_FILTERS)[number]['key'];

function matchesReviewFilter(row: ReadingRow, filter: ReviewFilter) {
  switch (filter) {
    case 'needs_review':
      return row.status === 'submitted' || row.status === 'flagged';
    case 'all':
      return true;
    default:
      return row.status === filter;
  }
}

export function ReadingReview() {
  const navigate = useNavigate();
  const { cycleId } = useParams<{ cycleId: string }>();
  const cycleIdNumber = Number(cycleId);

  const [cycle, setCycle] = useState<CycleInfo | null>(null);
  const [rows, setRows] = useState<ReadingRow[]>([]);
  const [filter, setFilter] = useState<ReviewFilter>('needs_review');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [cycleRows, readingRows] = await Promise.all([
        invoke<CycleInfo[]>('list_billing_cycles'),
        invoke<ReadingRow[]>('list_readings_for_cycle', {
          cycleId: cycleIdNumber,
          statusFilter: null,
        }),
      ]);

      setCycle(cycleRows.find((item) => item.id === cycleIdNumber) ?? null);
      setRows(readingRows);
    } catch (error: any) {
      toast.error(error.toString());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!Number.isFinite(cycleIdNumber)) {
      return;
    }
    void load();
  }, [cycleIdNumber]);

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
      if (!matchesReviewFilter(row, filter)) {
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
        row.flag_reason ?? '',
      ].join(' ').toLowerCase();

      return haystack.includes(search.toLowerCase());
    });
  }, [rows, filter, search]);

  const approve = async (row: ReadingRow) => {
    try {
      await invoke('approve_reading', { readingId: row.id });
      toast.success(`Approved ${row.building_code}-${row.unit_number}.`);
      await load();
    } catch (error: any) {
      toast.error(error.toString());
    }
  };

  const flag = async (row: ReadingRow) => {
    const reason = window.prompt('Flag reason', row.flag_reason ?? 'REQUIRES_REVIEW');
    if (!reason?.trim()) {
      return;
    }

    try {
      await invoke('flag_reading', {
        payload: { reading_id: row.id, flag_reason: reason.trim() },
      });
      toast.success(`Flagged ${row.building_code}-${row.unit_number}.`);
      await load();
    } catch (error: any) {
      toast.error(error.toString());
    }
  };

  const columns: Column<ReadingRow>[] = [
    {
      key: 'unit',
      header: 'Unit',
      render: (row) => (
        <div>
          <p className="font-mono text-xs font-medium text-gray-900">
            {row.building_code}-{row.floor_number}-{row.unit_number}
          </p>
          <p className="text-xs text-gray-500">{row.resident_name ?? 'No account linked'}</p>
        </div>
      ),
    },
    {
      key: 'meter',
      header: 'Meter',
      width: '110px',
      render: (row) => <span className="font-mono text-xs text-gray-500">{row.meter_number ?? '-'}</span>,
    },
    {
      key: 'previous',
      header: 'Previous',
      width: '90px',
      render: (row) => <span className="text-xs text-gray-700">{row.previous_reading.toFixed(2)}</span>,
    },
    {
      key: 'current',
      header: 'Current',
      width: '90px',
      render: (row) => (
        <span className="text-xs font-medium text-gray-900">
          {row.current_reading != null ? row.current_reading.toFixed(2) : '-'}
        </span>
      ),
    },
    {
      key: 'consumption',
      header: 'Consumption',
      width: '120px',
      render: (row) => (
        <span className="text-xs text-gray-700">
          {row.consumption != null ? cubicM(row.consumption) : '-'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '110px',
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'source',
      header: 'Source',
      width: '90px',
      render: (row) => <span className="text-xs capitalize text-gray-500">{row.source}</span>,
    },
    {
      key: 'flag_reason',
      header: 'Review Note',
      render: (row) => (
        <div className="space-y-1">
          <span className="text-xs text-orange-700">
            {row.flag_reason ?? row.notes ?? '-'}
          </span>
          {row.read_at && (
            <p className="text-[11px] text-gray-400">
              {new Date(row.read_at).toLocaleString('en-PH', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '250px',
      render: (row) => (
        <div className="flex justify-end gap-2" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            onClick={() => navigate(`/readings/manual/${cycleIdNumber}?focus=${row.id}`)}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 transition-colors hover:bg-gray-50"
          >
            <PencilLine size={12} />
            Adjust
          </button>
          {row.current_reading != null && row.status !== 'flagged' && row.status !== 'approved' && (
            <button
              type="button"
              onClick={() => flag(row)}
              className="inline-flex items-center gap-1 rounded-lg border border-amber-200 px-2.5 py-1.5 text-xs text-amber-700 transition-colors hover:bg-amber-50"
            >
              <TriangleAlert size={12} />
              Flag
            </button>
          )}
          {['submitted', 'flagged'].includes(row.status) && (
            <button
              type="button"
              onClick={() => approve(row)}
              className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-700"
            >
              <CheckCircle2 size={12} />
              Approve
            </button>
          )}
        </div>
      ),
    },
  ];

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
            <h2 className="text-base font-semibold text-gray-900">Review & Exceptions</h2>
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
            onClick={() => navigate(`/readings/manual/${cycleIdNumber}`)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
          >
            Open Manual Entry
          </button>
          <button
            type="button"
            onClick={() => navigate('/readings/sync')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
          >
            <Upload size={14} />
            Mobile Sync
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-900">Review queue purpose</h3>
        <p className="mt-2 text-sm leading-6 text-gray-600">
          Manual encoding happens in the dedicated workspace. This screen is for the second pass:
          check flagged or newly submitted readings, approve clean entries, and send questionable
          rows back for correction.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Needs Review</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">{counts.submitted + counts.flagged}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Submitted</p>
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
        <div className="flex flex-wrap gap-3">
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search unit, resident, meter, or note..."
            className="w-72 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex flex-wrap gap-2">
            {REVIEW_FILTERS.map((status) => (
              <button
                key={status.key}
                type="button"
                onClick={() => setFilter(status.key)}
                className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  filter === status.key
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {status.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filteredRows}
        rowKey={(row) => row.id}
        loading={loading}
        emptyMessage="No readings match the selected review filter."
      />
    </div>
  );
}
