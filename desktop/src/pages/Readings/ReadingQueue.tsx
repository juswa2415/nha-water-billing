import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Database, Gauge, TriangleAlert } from 'lucide-react';
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
      (acc, cycle) => ({
        totalUnits: acc.totalUnits + cycle.total_units,
        submitted: acc.submitted + cycle.readings_submitted,
        approved: acc.approved + cycle.readings_approved,
      }),
      { totalUnits: 0, submitted: 0, approved: 0 },
    );
  }, [cycles]);

  if (loading) {
    return <div className="p-8 text-sm text-gray-400">Loading reading queue...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="inline-flex rounded-lg bg-blue-50 p-2 text-blue-700">
            <Database size={16} />
          </div>
          <p className="mt-3 text-xs uppercase tracking-wide text-gray-500">Units in Queue</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{stats.totalUnits}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="inline-flex rounded-lg bg-amber-50 p-2 text-amber-700">
            <Gauge size={16} />
          </div>
          <p className="mt-3 text-xs uppercase tracking-wide text-gray-500">Submitted Readings</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{stats.submitted}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="inline-flex rounded-lg bg-green-50 p-2 text-green-700">
            <TriangleAlert size={16} />
          </div>
          <p className="mt-3 text-xs uppercase tracking-wide text-gray-500">Approved Readings</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{stats.approved}</p>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Reading Review Queue</h2>
            <p className="mt-1 text-sm text-gray-500">
              Open a cycle to approve imported readings, flag anomalies, or enter missing values manually.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/readings/sync')}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
          >
            Mobile Sync
          </button>
        </div>

        <div className="divide-y divide-gray-100">
          {cycles.length === 0 && (
            <div className="px-5 py-10 text-center text-sm text-gray-400">
              No billing cycles available yet.
            </div>
          )}
          {cycles.map((cycle) => {
            const remaining = Math.max(cycle.total_units - cycle.readings_submitted, 0);
            const percent = cycle.total_units > 0
              ? Math.round((cycle.readings_approved / cycle.total_units) * 100)
              : 0;

            return (
              <button
                key={cycle.id}
                type="button"
                onClick={() => navigate(`/readings/review/${cycle.id}`)}
                className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-gray-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-medium text-gray-900">
                      {formatDate(cycle.period_start)} - {formatDate(cycle.period_end)}
                    </p>
                    <StatusBadge status={cycle.status} />
                  </div>
                  <div className="mt-2 grid gap-2 text-xs text-gray-500 md:grid-cols-3">
                    <p>{cycle.readings_submitted} submitted</p>
                    <p>{cycle.readings_approved} approved</p>
                    <p>{remaining} still pending</p>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-gray-100">
                    <div
                      className="h-2 rounded-full bg-blue-600"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
                <ChevronRight size={16} className="shrink-0 text-gray-400" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
