import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, ClipboardPenLine, Database, Gauge, TriangleAlert, Upload } from 'lucide-react';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { formatDate } from '../../utils/formatters';

interface CycleRow {
  id: number;
  period_start: string;
  period_end: string;
  status: string;
  total_units: number;
  readings_submitted: number;
  readings_approved: number;
}

function isCycleEditable(status: string) {
  return ['draft', 'reading_phase', 'review_phase'].includes(status);
}

export function ReadingQueue() {
  const navigate = useNavigate();
  const [cycles, setCycles] = useState<CycleRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoke<CycleRow[]>('list_billing_cycles')
      .then(setCycles)
      .finally(() => setLoading(false));
  }, []);

  const stats = useMemo(() => {
    return cycles.reduce(
      (acc, cycle) => {
        acc.totalUnits += cycle.total_units;
        acc.submitted += cycle.readings_submitted;
        acc.approved += cycle.readings_approved;
        acc.pending += Math.max(cycle.total_units - cycle.readings_submitted, 0);
        return acc;
      },
      { totalUnits: 0, submitted: 0, approved: 0, pending: 0 },
    );
  }, [cycles]);

  const primaryCycle = useMemo(
    () => cycles.find((cycle) => isCycleEditable(cycle.status)) ?? cycles[0] ?? null,
    [cycles],
  );

  if (loading) {
    return <div className="p-8 text-sm text-gray-400">Loading readings workspace...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <h2 className="text-base font-semibold text-blue-950">Readings Workspace</h2>
            <p className="mt-2 text-sm leading-6 text-blue-900">
              Manual encoding is now the primary desktop workflow when the mobile app is unavailable.
              Start from a billing cycle, encode readings continuously by building or floor, then move
              only the questionable rows into review. Mobile Sync stays available as a secondary import path.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {primaryCycle && (
              <div className="rounded-full border border-blue-200 bg-white px-3 py-1.5 text-xs text-blue-900">
                Current working cycle: #{primaryCycle.id}
              </div>
            )}
            <button
              type="button"
              onClick={() => navigate('/readings/sync')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-4 py-2 text-sm text-blue-900 transition-colors hover:bg-blue-100"
            >
              <Upload size={14} />
              Mobile Sync
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="inline-flex rounded-lg bg-slate-100 p-2 text-slate-700">
            <Database size={16} />
          </div>
          <p className="mt-3 text-xs uppercase tracking-wide text-gray-500">Units Scheduled</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{stats.totalUnits}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="inline-flex rounded-lg bg-gray-100 p-2 text-gray-700">
            <Gauge size={16} />
          </div>
          <p className="mt-3 text-xs uppercase tracking-wide text-gray-500">Needs Entry</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{stats.pending}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="inline-flex rounded-lg bg-blue-50 p-2 text-blue-700">
            <ClipboardPenLine size={16} />
          </div>
          <p className="mt-3 text-xs uppercase tracking-wide text-gray-500">Entered</p>
          <p className="mt-1 text-2xl font-semibold text-blue-700">{stats.submitted}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="inline-flex rounded-lg bg-green-50 p-2 text-green-700">
            <TriangleAlert size={16} />
          </div>
          <p className="mt-3 text-xs uppercase tracking-wide text-gray-500">Approved</p>
          <p className="mt-1 text-2xl font-semibold text-green-700">{stats.approved}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-5 py-4">
          <h3 className="text-sm font-semibold text-gray-900">Cycle entry lanes</h3>
          <p className="mt-1 text-sm text-gray-500">
            Choose a cycle, open manual encoding for rapid desktop entry, then send only exceptions
            into review.
          </p>
        </div>

        <div className="divide-y divide-gray-100">
          {cycles.length === 0 && (
            <div className="px-5 py-10 text-center text-sm text-gray-400">
              No billing cycles available yet.
            </div>
          )}
          {cycles.map((cycle) => {
            const pending = Math.max(cycle.total_units - cycle.readings_submitted, 0);
            const encodedPercent = cycle.total_units > 0
              ? Math.round((cycle.readings_submitted / cycle.total_units) * 100)
              : 0;
            const approvedPercent = cycle.total_units > 0
              ? Math.round((cycle.readings_approved / cycle.total_units) * 100)
              : 0;

            return (
              <div key={cycle.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="text-sm font-medium text-gray-900">
                        {formatDate(cycle.period_start)} - {formatDate(cycle.period_end)}
                      </p>
                      <StatusBadge status={cycle.status} />
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-gray-500 md:grid-cols-4">
                      <p>{cycle.total_units} units in cycle</p>
                      <p>{pending} still need encoding</p>
                      <p>{cycle.readings_submitted} entered</p>
                      <p>{cycle.readings_approved} approved</p>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div>
                        <div className="flex items-center justify-between text-[11px] text-gray-500">
                          <span>Entry progress</span>
                          <span>{encodedPercent}%</span>
                        </div>
                        <div className="mt-1 h-2 rounded-full bg-gray-100">
                          <div
                            className="h-2 rounded-full bg-blue-600"
                            style={{ width: `${encodedPercent}%` }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between text-[11px] text-gray-500">
                          <span>Approved progress</span>
                          <span>{approvedPercent}%</span>
                        </div>
                        <div className="mt-1 h-2 rounded-full bg-gray-100">
                          <div
                            className="h-2 rounded-full bg-green-600"
                            style={{ width: `${approvedPercent}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => navigate(`/readings/manual/${cycle.id}`)}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      {isCycleEditable(cycle.status) ? 'Manual Entry' : 'View Manual Grid'}
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(`/readings/review/${cycle.id}`)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      Review & Exceptions
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
