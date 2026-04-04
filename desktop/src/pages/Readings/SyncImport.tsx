import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import toast from 'react-hot-toast';
import { Download, FileCheck2, Upload } from 'lucide-react';
import { importMobileReadings } from '../../services/syncService';

interface CycleOption {
  id: number;
  period_start: string;
  period_end: string;
}

interface ImportResult {
  total: number;
  imported: number;
  duplicates: number;
  flagged: number;
  errors: string[];
}

export function SyncImport() {
  const [cycles, setCycles] = useState<CycleOption[]>([]);
  const [cycleId, setCycleId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastImport, setLastImport] = useState<ImportResult | null>(null);

  useEffect(() => {
    invoke<CycleOption[]>('list_billing_cycles').then((data) => {
      setCycles(data);
      if (data.length > 0) {
        setCycleId(data[0].id);
      }
    });
  }, []);

  const handleExportList = async () => {
    if (!cycleId) {
      toast.error('Select a billing cycle first.');
      return;
    }

    const target = await save({
      defaultPath: `nha_reading_list_cycle_${cycleId}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });

    if (!target) {
      return;
    }

    setBusy(true);
    try {
      const count = await invoke<number>('export_reading_list', { cycleId, outputPath: target });
      toast.success(`Exported ${count} units for mobile reading.`);
    } catch (error: any) {
      toast.error(error.toString());
    } finally {
      setBusy(false);
    }
  };

  const handleImportReadings = async () => {
    const picked = await open({
      multiple: false,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });

    if (typeof picked !== 'string') {
      return;
    }

    setBusy(true);
    try {
      const result = await importMobileReadings(picked);
      setLastImport(result);
      toast.success(`Imported ${result.imported} mobile readings.`);
    } catch (error: any) {
      toast.error(error.toString());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-900">Mobile Sync</h2>
        <p className="mt-1 text-sm text-gray-500">
          Export a reading list for the field app, then import the completed mobile JSON back into the review queue.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <select
            value={cycleId ?? ''}
            onChange={(event) => setCycleId(Number(event.target.value))}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {cycles.map((cycle) => (
              <option key={cycle.id} value={cycle.id}>
                Cycle #{cycle.id} - {cycle.period_start} to {cycle.period_end}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void handleExportList()}
            disabled={busy || !cycleId}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60"
          >
            <Download size={14} />
            Export Reading List
          </button>
          <button
            type="button"
            onClick={() => void handleImportReadings()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
          >
            <Upload size={14} />
            Import Mobile Readings
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-gray-900">Workflow</h3>
          <div className="mt-3 space-y-2 text-sm text-gray-600">
            <p>1. Export the current cycle's reading list to JSON.</p>
            <p>2. Load that file into the Flutter mobile app for offline reading.</p>
            <p>3. After field collection, import the mobile export back here.</p>
            <p>4. Review flagged readings before bill generation.</p>
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-gray-900">Conflict Rules</h3>
          <div className="mt-3 space-y-2 text-sm text-gray-600">
            <p>Duplicate unit submissions are skipped unless the new reading is newer.</p>
            <p>Readings below the previous value are flagged automatically.</p>
            <p>Abnormal spikes compared to prior approved readings are flagged for review.</p>
          </div>
        </div>
      </div>

      {lastImport && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            <FileCheck2 size={15} />
            Last Import Summary
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <div className="rounded-lg bg-blue-50 p-4">
              <p className="text-xs text-blue-700">Readings in File</p>
              <p className="mt-1 text-xl font-semibold text-blue-900">{lastImport.total}</p>
            </div>
            <div className="rounded-lg bg-green-50 p-4">
              <p className="text-xs text-green-700">Imported</p>
              <p className="mt-1 text-xl font-semibold text-green-900">{lastImport.imported}</p>
            </div>
            <div className="rounded-lg bg-amber-50 p-4">
              <p className="text-xs text-amber-700">Duplicates</p>
              <p className="mt-1 text-xl font-semibold text-amber-900">{lastImport.duplicates}</p>
            </div>
            <div className="rounded-lg bg-orange-50 p-4">
              <p className="text-xs text-orange-700">Flagged</p>
              <p className="mt-1 text-xl font-semibold text-orange-900">{lastImport.flagged}</p>
            </div>
          </div>

          {lastImport.errors.length > 0 && (
            <div className="mt-4 rounded-lg border border-orange-200 bg-orange-50 p-4">
              <p className="text-sm font-semibold text-orange-900">Import Errors</p>
              <div className="mt-2 space-y-1 font-mono text-xs text-orange-800">
                {lastImport.errors.map((error, index) => (
                  <p key={`${error}-${index}`}>{error}</p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
