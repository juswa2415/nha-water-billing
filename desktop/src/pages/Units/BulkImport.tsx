import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import toast from 'react-hot-toast';
import { AlertTriangle, CheckCircle2, Database, FileUp } from 'lucide-react';

interface BulkImportResult {
  total: number;
  imported: number;
  skipped: number;
  errors: string[];
}

export function BulkImport() {
  const [selectedPath, setSelectedPath] = useState('');
  const [result, setResult] = useState<BulkImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const demoPath = 'C:\\Users\\peria\\Downloads\\nha-water-billing\\sample-data\\desktop-demo-units.csv';

  const chooseFile = async () => {
    try {
      const picked = await open({
        multiple: false,
        filters: [{ name: 'CSV Files', extensions: ['csv'] }],
      });

      if (typeof picked === 'string') {
        setSelectedPath(picked);
      }
    } catch (error: any) {
      toast.error(`File picker failed: ${error?.toString?.() ?? 'unknown error'}`);
    }
  };

  const runImport = async () => {
    if (!selectedPath) {
      toast.error('Choose a CSV file first.');
      return;
    }

    setLoading(true);
    try {
      const data = await invoke<BulkImportResult>('bulk_import_units', { csvPath: selectedPath });
      setResult(data);
      toast.success(`Imported ${data.imported} units.`);
    } catch (error: any) {
      toast.error(error.toString());
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-blue-50 p-2 text-blue-700">
            <Database size={18} />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-gray-900">Bulk Import Units</h2>
            <p className="mt-1 text-sm text-gray-500">
              Import units, resident accounts, and meter numbers using the CSV format defined in the design:
              `building_code,floor_number,unit_number,meter_number,status,resident_name,contact,account_number`
            </p>
          </div>
        </div>
        <div className="mt-5 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Selected File</p>
          <p className="mt-2 break-all font-mono text-xs text-gray-700">
            {selectedPath || 'No CSV file selected yet.'}
          </p>
          <div className="mt-4">
            <label className="block text-xs font-medium uppercase tracking-wide text-gray-500">
              CSV Path
            </label>
            <input
              type="text"
              value={selectedPath}
              onChange={(e) => setSelectedPath(e.target.value)}
              placeholder={demoPath}
              className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-2 text-xs text-gray-500">
              If the file picker is blocked, paste the full CSV path here.
            </p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={chooseFile}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-white"
            >
              <FileUp size={14} />
              Choose CSV
            </button>
            <button
              type="button"
              onClick={() => setSelectedPath(demoPath)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700 transition-colors hover:bg-blue-100"
            >
              Use Demo CSV
            </button>
            <button
              type="button"
              onClick={runImport}
              disabled={loading || !selectedPath}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
            >
              {loading ? 'Importing...' : 'Import Units'}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-900">CSV Notes</h3>
        <div className="mt-3 space-y-2 text-sm text-gray-600">
          <p>Buildings and floors must already exist in the desktop database.</p>
          <p>Duplicate unit numbers on the same floor are skipped automatically.</p>
          <p>Resident account numbers are auto-generated when the CSV leaves them blank.</p>
        </div>
      </div>

      {result && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-blue-50 p-4">
              <p className="text-xs text-blue-700">Rows Read</p>
              <p className="mt-1 text-xl font-semibold text-blue-900">{result.total}</p>
            </div>
            <div className="rounded-lg bg-green-50 p-4">
              <p className="inline-flex items-center gap-1 text-xs text-green-700">
                <CheckCircle2 size={13} />
                Imported
              </p>
              <p className="mt-1 text-xl font-semibold text-green-900">{result.imported}</p>
            </div>
            <div className="rounded-lg bg-amber-50 p-4">
              <p className="inline-flex items-center gap-1 text-xs text-amber-700">
                <AlertTriangle size={13} />
                Skipped
              </p>
              <p className="mt-1 text-xl font-semibold text-amber-900">{result.skipped}</p>
            </div>
          </div>

          {result.errors.length > 0 && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-900">Import Warnings</p>
              <div className="mt-2 space-y-1 font-mono text-xs text-amber-800">
                {result.errors.map((error, index) => (
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
