import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, CheckCircle2, PencilLine, TriangleAlert } from 'lucide-react';
import { DataTable, type Column } from '../../components/shared/DataTable';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { cubicM, formatDate } from '../../utils/formatters';

interface ReadingRow {
  id: number;
  unit_id: number;
  unit_number: string;
  building_code: string;
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
  source: string;
}

interface CycleInfo {
  id: number;
  period_start: string;
  period_end: string;
  status: string;
}

export function ReadingReview() {
  const navigate = useNavigate();
  const { cycleId } = useParams<{ cycleId: string }>();
  const cycleIdNumber = Number(cycleId);

  const [cycle, setCycle] = useState<CycleInfo | null>(null);
  const [rows, setRows] = useState<ReadingRow[]>([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [manualTarget, setManualTarget] = useState<ReadingRow | null>(null);
  const [manualCurrent, setManualCurrent] = useState('');
  const [manualNotes, setManualNotes] = useState('');
  const [savingManual, setSavingManual] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [cycleRows, readingRows] = await Promise.all([
        invoke<CycleInfo[]>('list_billing_cycles'),
        invoke<ReadingRow[]>('list_readings_for_cycle', {
          cycleId: cycleIdNumber,
          statusFilter: filter === 'all' ? null : filter,
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
  }, [cycleIdNumber, filter]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const haystack = [
        row.building_code,
        row.unit_number,
        row.resident_name ?? '',
        row.meter_number ?? '',
      ].join(' ').toLowerCase();

      return !search || haystack.includes(search.toLowerCase());
    });
  }, [rows, search]);

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

  const openManualEntry = (row: ReadingRow) => {
    setManualTarget(row);
    setManualCurrent(row.current_reading?.toString() ?? '');
    setManualNotes(row.notes ?? '');
  };

  const saveManualEntry = async () => {
    if (!manualTarget) {
      return;
    }

    const current = Number(manualCurrent);
    if (!Number.isFinite(current)) {
      toast.error('Enter a valid current reading.');
      return;
    }

    setSavingManual(true);
    try {
      await invoke('manual_entry_reading', {
        payload: {
          unit_id: manualTarget.unit_id,
          billing_cycle_id: manualTarget.billing_cycle_id,
          previous_reading: manualTarget.previous_reading,
          current_reading: current,
          notes: manualNotes.trim() || null,
        },
      });
      toast.success('Manual reading saved.');
      setManualTarget(null);
      setManualCurrent('');
      setManualNotes('');
      await load();
    } catch (error: any) {
      toast.error(error.toString());
    } finally {
      setSavingManual(false);
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
      header: 'Flag',
      render: (row) => (
        <span className="text-xs text-orange-700">
          {row.flag_reason ?? row.notes ?? '-'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '220px',
      render: (row) => (
        <div className="flex justify-end gap-2" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            onClick={() => openManualEntry(row)}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 transition-colors hover:bg-gray-50"
          >
            <PencilLine size={12} />
            Enter
          </button>
          {row.current_reading != null && row.status !== 'flagged' && (
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
            <h2 className="text-sm font-semibold text-gray-900">Reading Review</h2>
            {cycle && (
              <p className="mt-1 text-sm text-gray-500">
                Cycle #{cycle.id} - {formatDate(cycle.period_start)} to {formatDate(cycle.period_end)}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search unit or resident..."
            className="w-52 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {['all', 'pending', 'submitted', 'flagged', 'approved'].map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setFilter(status)}
              className={`rounded-full border px-3 py-1.5 text-xs capitalize transition-colors ${
                filter === status
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-gray-300 bg-white text-gray-600'
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filteredRows}
        rowKey={(row) => row.id}
        loading={loading}
        emptyMessage="No readings match the selected filter."
      />

      {manualTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setManualTarget(null)} />
          <div className="relative w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
            <h3 className="text-sm font-semibold text-gray-900">
              Manual Entry - {manualTarget.building_code}-{manualTarget.unit_number}
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              Previous reading: {manualTarget.previous_reading.toFixed(2)} cu.m
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-600">Current Reading</label>
                <input
                  type="number"
                  step="0.01"
                  value={manualCurrent}
                  onChange={(event) => setManualCurrent(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-600">Notes</label>
                <textarea
                  value={manualNotes}
                  onChange={(event) => setManualNotes(event.target.value)}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Optional review notes"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setManualTarget(null)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveManualEntry()}
                disabled={savingManual}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
              >
                {savingManual ? 'Saving...' : 'Save Reading'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
