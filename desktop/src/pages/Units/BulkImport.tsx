import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Copy,
  Database,
  FileJson2,
  FileSpreadsheet,
  FileUp,
  Info,
  Upload,
} from 'lucide-react';

interface BulkImportResult {
  total: number;
  imported: number;
  skipped: number;
  errors: string[];
  format: string;
}

interface Building {
  id: number;
  code: string;
  name: string;
  total_floors: number;
  active_units: number;
  total_units: number;
}

const CSV_TEMPLATE =
  'building_code,floor_number,unit_number,meter_number,status,resident_name,contact,account_number';

const JSON_TEMPLATE = JSON.stringify(
  {
    units: [
      {
        building_code: 'BLDG-13',
        floor_number: 2,
        unit_number: '206',
        meter_number: 'WM-13-206',
        status: 'active',
        resident_name: 'DELA CRUZ, Maria',
        contact: '09171234567',
        account_number: 'ACC-13-206',
      },
    ],
  },
  null,
  2,
);

export function BulkImport() {
  const [selectedPath, setSelectedPath] = useState('');
  const [result, setResult] = useState<BulkImportResult | null>(null);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    invoke<Building[]>('list_buildings')
      .then(setBuildings)
      .catch(error => toast.error(String(error)));
  }, []);

  const selectedFormat = selectedPath.split('.').pop()?.toUpperCase() || 'AUTO';
  const readyBuildings = useMemo(
    () => buildings.filter(building => building.total_floors > 0).length,
    [buildings],
  );

  const chooseFile = async () => {
    try {
      const picked = await open({
        multiple: false,
        filters: [
          { name: 'Unit Import Files', extensions: ['csv', 'json'] },
          { name: 'CSV Files', extensions: ['csv'] },
          { name: 'JSON Files', extensions: ['json'] },
        ],
      });

      if (typeof picked === 'string') {
        setSelectedPath(picked);
      }
    } catch (error: any) {
      toast.error(`File picker failed: ${error?.toString?.() ?? 'unknown error'}`);
    }
  };

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied.`);
    } catch (error) {
      toast.error(`Could not copy ${label.toLowerCase()}. ${String(error)}`);
    }
  };

  const runImport = async () => {
    if (!selectedPath) {
      toast.error('Choose a CSV or JSON file first.');
      return;
    }

    setLoading(true);
    try {
      const data = await invoke<BulkImportResult>('bulk_import_units', {
        csvPath: selectedPath,
      });
      setResult(data);
      toast.success(`Imported ${data.imported} units from ${data.format}.`);
    } catch (error: any) {
      toast.error(error.toString());
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-blue-600">
          Portfolio Import
        </p>
        <h1 className="text-2xl font-semibold text-gray-900">Bulk Import Units</h1>
        <p className="max-w-3xl text-sm text-gray-500">
          Import a unit portfolio from CSV or JSON without crowding the page. Use the primary card
          below, then open guidance only when you need it.
        </p>
      </header>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-blue-50 p-2 text-blue-700">
              <Upload size={18} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Source File</h2>
              <p className="mt-1 text-sm text-gray-500">
                Choose a file or paste its absolute path if the file picker is blocked.
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Pill label={`Format: ${selectedFormat}`} />
              <Pill label="CSV and JSON supported" />
            </div>

            <p className="mt-4 break-all font-mono text-xs text-gray-700">
              {selectedPath || 'No import file selected yet.'}
            </p>

            <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-gray-500">
              File Path
            </label>
            <input
              type="text"
              value={selectedPath}
              onChange={event => setSelectedPath(event.target.value)}
              placeholder="C:\\imports\\units-portfolio.csv"
              className="mt-2 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 font-mono text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={chooseFile}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-300 px-3.5 py-2 text-sm text-gray-700 transition-colors hover:bg-white"
              >
                <FileUp size={15} />
                Choose File
              </button>
              <button
                type="button"
                onClick={runImport}
                disabled={loading || !selectedPath}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
              >
                {loading ? 'Importing...' : 'Import Portfolio'}
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-emerald-50 p-2 text-emerald-700">
              <CheckCircle2 size={18} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Import Snapshot</h2>
              <p className="mt-1 text-sm text-gray-500">
                Quick readiness view before you run the import.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <SnapshotTile label="Ready buildings" value={`${readyBuildings}/${buildings.length}`} />
            <SnapshotTile
              label="Configured floors"
              value={String(buildings.reduce((sum, building) => sum + building.total_floors, 0))}
            />
            <SnapshotTile
              label="Directory units"
              value={String(buildings.reduce((sum, building) => sum + building.total_units, 0))}
            />
            <SnapshotTile
              label="Active units"
              value={String(buildings.reduce((sum, building) => sum + building.active_units, 0))}
            />
          </div>

          <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
            Imports only land on floors that already exist in the desktop directory.
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <Disclosure
          title="Supported formats"
          subtitle="When to use CSV versus JSON."
          icon={<Info size={16} />}
          defaultOpen={false}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <CompactInfoCard
              icon={<FileSpreadsheet size={16} />}
              title="CSV Spreadsheet"
              note="Best for admin-maintained sheets or legacy exports."
            />
            <CompactInfoCard
              icon={<FileJson2 size={16} />}
              title="JSON Package"
              note="Best for system-generated portfolios and future sync packages."
            />
          </div>
        </Disclosure>

        <Disclosure
          title="Destination readiness"
          subtitle="Check which buildings already have floors prepared."
          icon={<Database size={16} />}
          defaultOpen={false}
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {buildings.map(building => (
              <div
                key={building.id}
                className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {building.code} - {building.name}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {building.total_floors} floors configured
                    </p>
                  </div>
                  <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-gray-500">
                    {building.total_units} units
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Disclosure>

        <Disclosure
          title="Templates and rules"
          subtitle="Open only when you need sample payloads or import rules."
          icon={<Copy size={16} />}
          defaultOpen={false}
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-gray-900">CSV Header</p>
                <button
                  type="button"
                  onClick={() => copyText(CSV_TEMPLATE, 'CSV header')}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                >
                  <Copy size={13} />
                  Copy
                </button>
              </div>
              <pre className="mt-3 overflow-x-auto rounded-xl bg-white p-3 font-mono text-[11px] text-gray-700">
                {CSV_TEMPLATE}
              </pre>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-gray-900">JSON Example</p>
                <button
                  type="button"
                  onClick={() => copyText(JSON_TEMPLATE, 'JSON template')}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                >
                  <Copy size={13} />
                  Copy
                </button>
              </div>
              <pre className="mt-3 max-h-48 overflow-auto rounded-xl bg-white p-3 font-mono text-[11px] text-gray-700">
                {JSON_TEMPLATE}
              </pre>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <RuleChip label="Duplicates on the same floor are skipped" />
            <RuleChip label="Blank account numbers are auto-generated" />
            <RuleChip label="Status must stay within active, vacant, inactive, or disconnected" />
          </div>
        </Disclosure>
      </section>

      {result && (
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="grid gap-3 md:grid-cols-4">
            <ResultTile label="Source Format" value={result.format} tone="slate" />
            <ResultTile label="Rows Read" value={String(result.total)} tone="blue" />
            <ResultTile label="Imported" value={String(result.imported)} tone="emerald" />
            <ResultTile label="Skipped" value={String(result.skipped)} tone="amber" />
          </div>

          {result.errors.length > 0 && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="inline-flex items-center gap-2 text-sm font-semibold text-amber-900">
                <AlertTriangle size={15} />
                Import Warnings
              </p>
              <div className="mt-3 space-y-1 font-mono text-xs text-amber-800">
                {result.errors.map((error, index) => (
                  <p key={`${error}-${index}`}>{error}</p>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Disclosure({
  title,
  subtitle,
  icon,
  children,
  defaultOpen = false,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      className="group rounded-2xl border border-gray-200 bg-white shadow-sm"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-gray-50 p-2 text-gray-700">{icon}</div>
          <div>
            <p className="text-sm font-semibold text-gray-900">{title}</p>
            <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>
          </div>
        </div>
        <ChevronDown
          size={16}
          className="text-gray-400 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="border-t border-gray-100 px-5 py-4">{children}</div>
    </details>
  );
}

function Pill({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-gray-500">
      {label}
    </span>
  );
}

function SnapshotTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-2 text-xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function CompactInfoCard({
  icon,
  title,
  note,
}: {
  icon: React.ReactNode;
  title: string;
  note: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
      <div className="rounded-xl bg-white p-2 text-gray-700 inline-flex">{icon}</div>
      <h3 className="mt-3 text-sm font-semibold text-gray-900">{title}</h3>
      <p className="mt-1 text-xs text-gray-500">{note}</p>
    </div>
  );
}

function RuleChip({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600">
      {label}
    </div>
  );
}

function ResultTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'slate' | 'blue' | 'emerald' | 'amber';
}) {
  const toneClasses = {
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
    blue: 'border-blue-100 bg-blue-50 text-blue-700',
    emerald: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-100 bg-amber-50 text-amber-700',
  }[tone];

  return (
    <div className={`rounded-2xl border p-4 ${toneClasses}`}>
      <p className="text-xs uppercase tracking-wide text-current/80">{label}</p>
      <p className="mt-2 text-xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}
