import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import toast from 'react-hot-toast';
import {
  FileUp,
  PlugZap,
  RotateCcw,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import { ConfirmDialog } from '../../components/shared/ConfirmDialog';
import { PaginationBar } from '../../components/shared/PaginationBar';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { formatDate, php } from '../../utils/formatters';

type CaseTab = 'eligible' | 'watch' | 'disconnected' | 'history';

interface ServiceCaseRow {
  unit_id: number;
  account_id: number | null;
  building_code: string;
  building_name: string;
  floor_number: number;
  unit_number: string;
  unit_status: string;
  resident_name: string | null;
  account_number: string | null;
  outstanding_balance: number;
  unpaid_periods: number;
  disconnection_effective_date: string | null;
  is_subject_for_disconnection: boolean;
  can_disconnect: boolean;
  can_reconnect: boolean;
  service_stage: string;
  last_action_id: number | null;
  last_action_type: string | null;
  last_action_date: string | null;
  last_action_reason: string | null;
}

interface ServiceActionHistoryRow {
  id: number;
  unit_id: number;
  account_id: number | null;
  action_type: string;
  action_date: string;
  effective_date: string | null;
  outstanding_balance: number;
  unpaid_periods: number;
  reason: string;
  notes: string | null;
  building_code: string;
  unit_number: string;
  resident_name: string | null;
  account_number: string | null;
  recorded_by_name: string | null;
  documents_count: number;
}

interface PendingDocument {
  sourcePath: string;
  documentType: string;
  notes: string;
  originalName: string;
}

const DOCUMENT_TYPES = [
  { value: 'meter_pullout_photo', label: 'Meter Pull-out Photo' },
  { value: 'unpaid_bill_copy', label: 'Unpaid Bill Copy' },
  { value: 'notice_served', label: 'Notice Served' },
  { value: 'field_report', label: 'Field Report' },
  { value: 'meter_reinstall_photo', label: 'Meter Reinstall Photo' },
  { value: 'reconnection_clearance', label: 'Reconnection Clearance' },
  { value: 'other', label: 'Other' },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function fileNameFromPath(path: string) {
  return path.split(/[/\\]/).pop() || path;
}

function stageMeta(stage: string) {
  switch (stage) {
    case 'eligible':
      return {
        label: 'Eligible now',
        className: 'border-red-200 bg-red-50 text-red-700',
      };
    case 'watch':
      return {
        label: 'Under watch',
        className: 'border-amber-200 bg-amber-50 text-amber-700',
      };
    case 'ready_reconnect':
      return {
        label: 'Ready for reconnection',
        className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      };
    default:
      return {
        label: 'Disconnected',
        className: 'border-gray-200 bg-gray-100 text-gray-700',
      };
  }
}

export function ServiceCases() {
  const [cases, setCases] = useState<ServiceCaseRow[]>([]);
  const [history, setHistory] = useState<ServiceActionHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<CaseTab>('eligible');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null);
  const [actionDate, setActionDate] = useState(today());
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [pendingDocuments, setPendingDocuments] = useState<PendingDocument[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmMode, setConfirmMode] = useState<'disconnect' | 'reconnect' | null>(null);
  const casesListRef = useRef<HTMLDivElement | null>(null);
  const historyListRef = useRef<HTMLDivElement | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [caseRows, historyRows] = await Promise.all([
        invoke<ServiceCaseRow[]>('list_service_cases'),
        invoke<ServiceActionHistoryRow[]>('list_service_action_history'),
      ]);
      setCases(caseRows);
      setHistory(historyRows);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const eligibleCount = cases.filter(item => item.service_stage === 'eligible').length;
  const watchCount = cases.filter(item => item.service_stage === 'watch').length;
  const disconnectedCount = cases.filter(
    item => item.service_stage === 'disconnected' || item.service_stage === 'ready_reconnect'
  ).length;
  const readyReconnectCount = cases.filter(item => item.service_stage === 'ready_reconnect').length;

  const filteredCases = useMemo(() => {
    switch (activeTab) {
      case 'eligible':
        return cases.filter(item => item.service_stage === 'eligible');
      case 'watch':
        return cases.filter(item => item.service_stage === 'watch');
      case 'disconnected':
        return cases.filter(
          item => item.service_stage === 'disconnected' || item.service_stage === 'ready_reconnect'
        );
      default:
        return [];
    }
  }, [activeTab, cases]);

  const searchedCases = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) {
      return filteredCases;
    }

    return filteredCases.filter(item => {
      const haystack = [
        `${item.building_code}-${item.unit_number}`,
        item.unit_number,
        item.resident_name ?? '',
        item.account_number ?? '',
        item.building_name,
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [filteredCases, searchTerm]);

  const searchedHistory = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) {
      return history;
    }

    return history.filter(item => {
      const haystack = [
        `${item.building_code}-${item.unit_number}`,
        item.unit_number,
        item.resident_name ?? '',
        item.account_number ?? '',
        item.reason,
        item.recorded_by_name ?? '',
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [history, searchTerm]);

  const paginatedCases = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return searchedCases.slice(start, start + pageSize);
  }, [currentPage, pageSize, searchedCases]);

  const paginatedHistory = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return searchedHistory.slice(start, start + pageSize);
  }, [currentPage, pageSize, searchedHistory]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchTerm]);

  useEffect(() => {
    const target = activeTab === 'history' ? historyListRef.current : casesListRef.current;
    target?.scrollTo({ top: 0, behavior: 'auto' });
  }, [activeTab, currentPage, pageSize, searchTerm]);

  useEffect(() => {
    if (activeTab === 'history') {
      setSelectedUnitId(null);
      return;
    }

    if (paginatedCases.length === 0) {
      setSelectedUnitId(null);
      return;
    }

    const stillExists = paginatedCases.some(item => item.unit_id === selectedUnitId);
    if (!stillExists) {
      setSelectedUnitId(paginatedCases[0].unit_id);
    }
  }, [activeTab, paginatedCases, selectedUnitId]);

  useEffect(() => {
    setActionDate(today());
    setReason('');
    setNotes('');
    setPendingDocuments([]);
  }, [selectedUnitId, activeTab]);

  const selectedCase =
    paginatedCases.find(item => item.unit_id === selectedUnitId) ?? null;

  const chooseFiles = async () => {
    try {
      const picked = await open({
        multiple: true,
        filters: [
          { name: 'Documents', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'doc', 'docx'] },
        ],
      });
      const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
      if (paths.length === 0) return;

      setPendingDocuments(current => {
        const existing = new Set(current.map(item => item.sourcePath));
        const additions = paths
          .filter(path => !existing.has(path))
          .map(path => ({
            sourcePath: path,
            documentType:
              activeTab === 'disconnected' ? 'meter_reinstall_photo' : 'meter_pullout_photo',
            notes: '',
            originalName: fileNameFromPath(path),
          }));
        return [...current, ...additions];
      });
    } catch (error) {
      toast.error(`Could not choose files. ${String(error)}`);
    }
  };

  const updatePendingDocument = (
    index: number,
    key: keyof Pick<PendingDocument, 'documentType' | 'notes'>,
    value: string
  ) => {
    setPendingDocuments(current =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: value } : item
      )
    );
  };

  const removePendingDocument = (index: number) => {
    setPendingDocuments(current => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const submitAction = async () => {
    if (!selectedCase) return;

    const payload = {
      unitId: selectedCase.unit_id,
      actionDate,
      reason,
      notes: notes.trim() || null,
      documents: pendingDocuments.map(document => ({
        sourcePath: document.sourcePath,
        documentType: document.documentType,
        notes: document.notes.trim() || null,
      })),
    };

    setSaving(true);
    try {
      if (confirmMode === 'disconnect') {
        await invoke('record_service_disconnection', { payload });
        toast.success('Disconnection record saved.');
        setActiveTab('disconnected');
      } else if (confirmMode === 'reconnect') {
        await invoke('record_service_reconnection', { payload });
        toast.success('Reconnection record saved.');
      }

      setConfirmMode(null);
      await loadData();
    } catch (error) {
      toast.error(String(error));
    } finally {
      setSaving(false);
    }
  };

  const canSubmitDisconnect =
    selectedCase?.can_disconnect && reason.trim().length > 0 && pendingDocuments.length > 0;
  const canSubmitReconnect =
    selectedCase?.can_reconnect && reason.trim().length > 0 && pendingDocuments.length > 0;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-blue-700" />
          <p className="text-sm font-semibold text-blue-900">Service cases</p>
        </div>
        <p className="mt-2 text-sm text-blue-900">
          Bills keep one consistent printed policy notice. Actual disconnection and reconnection
          operations are tracked here with evidence, staff notes, and unit status changes.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-[0.15em] text-gray-500">Eligible now</p>
          <p className="mt-2 text-3xl font-semibold text-red-600">{eligibleCount}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-[0.15em] text-gray-500">Under watch</p>
          <p className="mt-2 text-3xl font-semibold text-amber-600">{watchCount}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-[0.15em] text-gray-500">Disconnected</p>
          <p className="mt-2 text-3xl font-semibold text-gray-800">{disconnectedCount}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-[0.15em] text-gray-500">Ready to reconnect</p>
          <p className="mt-2 text-3xl font-semibold text-emerald-600">{readyReconnectCount}</p>
        </div>
      </div>

      <div className="sticky top-0 z-20 rounded-2xl border border-gray-200 bg-white/95 p-3 shadow-sm backdrop-blur">
        <div className="flex flex-wrap gap-2">
          {[
            { key: 'eligible', label: 'Eligible now' },
            { key: 'watch', label: 'Under watch' },
            { key: 'disconnected', label: 'Disconnected' },
            { key: 'history', label: 'History' },
          ].map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key as CaseTab)}
              className={`rounded-full px-4 py-2 text-sm transition-colors ${
                activeTab === tab.key
                  ? 'bg-blue-600 text-white'
                  : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:h-[calc(100vh-5.25rem)] xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)] xl:items-stretch">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 xl:flex xl:min-h-0 xl:flex-col xl:overflow-hidden">
          {activeTab === 'history' ? (
            <div className="flex h-full flex-col gap-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Service history</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Every disconnect and reconnect action stays here with its supporting document count.
                </p>
              </div>

              <div className="relative">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search unit, resident, account, or reason"
                  className="w-full rounded-xl border border-gray-300 bg-white py-2.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {loading ? (
                <div className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-sm text-gray-400">
                  Loading service history...
                </div>
              ) : searchedHistory.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-sm text-gray-400">
                  No service actions have been recorded yet.
                </div>
              ) : (
                <>
                  <div ref={historyListRef} className="flex-1 overflow-y-auto pr-1">
                    <div className="space-y-3">
                      {paginatedHistory.map(item => (
                        <div
                          key={item.id}
                          className="rounded-2xl border border-gray-200 px-4 py-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold text-gray-900">
                                  {item.building_code}-{item.unit_number}
                                </p>
                                <span
                                  className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                                    item.action_type === 'disconnection'
                                      ? 'border-red-200 bg-red-50 text-red-700'
                                      : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                  }`}
                                >
                                  {item.action_type === 'disconnection' ? 'Disconnected' : 'Reconnected'}
                                </span>
                              </div>
                              <p className="mt-1 text-sm text-gray-600">
                                {item.resident_name ?? 'No resident name'} • {item.account_number ?? 'No account'}
                              </p>
                              <p className="mt-1 text-xs text-gray-500">
                                {formatDate(item.action_date)} • {item.recorded_by_name ?? 'Unknown staff'} •{' '}
                                {item.documents_count} document{item.documents_count === 1 ? '' : 's'}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-xs text-gray-500">Balance at action time</p>
                              <p className="text-sm font-semibold text-gray-900">{php(item.outstanding_balance)}</p>
                            </div>
                          </div>
                          <div className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700">
                            <strong>{item.reason}</strong>
                            {item.notes ? <span className="mt-1 block text-gray-500">{item.notes}</span> : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <PaginationBar
                    currentPage={currentPage}
                    pageSize={pageSize}
                    totalItems={searchedHistory.length}
                    onPageChange={setCurrentPage}
                    onPageSizeChange={setPageSize}
                    pageSizeOptions={[5, 8, 12]}
                  />
                </>
              )}
            </div>
          ) : (
            <div className="flex h-full flex-col gap-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">
                  {activeTab === 'eligible'
                    ? 'Units already eligible for disconnection'
                    : activeTab === 'watch'
                    ? 'Accounts under watch'
                    : 'Disconnected units'}
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Select a row to prepare the operational record and evidence on the right.
                </p>
              </div>

              <div className="relative">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search unit number or resident"
                  className="w-full rounded-xl border border-gray-300 bg-white py-2.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {loading ? (
                <div className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-sm text-gray-400">
                  Loading service cases...
                </div>
              ) : searchedCases.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-sm text-gray-400">
                  Nothing to show in this view.
                </div>
              ) : (
                <>
                  <div ref={casesListRef} className="flex-1 overflow-y-auto pr-1">
                    <div className="space-y-3">
                      {paginatedCases.map(item => {
                        const stage = stageMeta(item.service_stage);
                        const selected = item.unit_id === selectedUnitId;
                        const secondaryLabel =
                          item.unit_status === 'disconnected' ? 'Next step' : 'Eligibility date';
                        const secondaryValue =
                          item.unit_status === 'disconnected'
                            ? item.can_reconnect
                              ? 'Ready to reconnect'
                              : 'Balance not yet cleared'
                            : item.disconnection_effective_date
                            ? formatDate(item.disconnection_effective_date)
                            : 'Not triggered yet';

                        return (
                          <button
                            type="button"
                            key={item.unit_id}
                            onClick={() => setSelectedUnitId(item.unit_id)}
                            className={`w-full rounded-2xl border px-4 py-4 text-left transition-colors ${
                              selected
                                ? 'border-blue-300 bg-blue-50'
                                : 'border-gray-200 bg-white hover:bg-gray-50'
                            }`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-semibold text-gray-900">
                                    {item.building_code}-{item.unit_number}
                                  </p>
                                  <span
                                    className={`rounded-full border px-2.5 py-1 text-xs font-medium ${stage.className}`}
                                  >
                                    {stage.label}
                                  </span>
                                  <StatusBadge status={item.unit_status} />
                                </div>
                                <p className="mt-1 text-sm text-gray-600">
                                  {item.resident_name ?? 'No resident'} • {item.account_number ?? 'No account'}
                                </p>
                                <p className="mt-1 text-xs text-gray-500">
                                  Floor {item.floor_number} • {item.building_name}
                                </p>
                              </div>

                              <div className="text-right">
                                <p className="text-xs text-gray-500">Open balance</p>
                                <p className="text-sm font-semibold text-gray-900">
                                  {php(item.outstanding_balance)}
                                </p>
                              </div>
                            </div>

                            <div className="mt-3 grid gap-3 text-xs text-gray-600 md:grid-cols-3">
                              <div>
                                <span className="font-medium text-gray-500">Unpaid periods</span>
                                <p className="mt-1 text-sm font-semibold text-gray-900">{item.unpaid_periods}</p>
                              </div>
                              <div>
                                <span className="font-medium text-gray-500">{secondaryLabel}</span>
                                <p className="mt-1 text-sm font-semibold text-gray-900">{secondaryValue}</p>
                              </div>
                              <div>
                                <span className="font-medium text-gray-500">Last action</span>
                                <p className="mt-1 text-sm font-semibold text-gray-900">
                                  {item.last_action_type
                                    ? `${item.last_action_type} • ${item.last_action_date ? formatDate(item.last_action_date) : '-'}`
                                    : 'No recorded service action'}
                                </p>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <PaginationBar
                    currentPage={currentPage}
                    pageSize={pageSize}
                    totalItems={searchedCases.length}
                    onPageChange={setCurrentPage}
                    onPageSizeChange={setPageSize}
                    pageSizeOptions={[6, 8, 12]}
                  />
                </>
              )}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 xl:flex xl:h-full xl:min-h-0 xl:flex-col xl:overflow-hidden">
          {activeTab === 'history' ? (
            <div className="flex h-full items-center rounded-xl border border-dashed border-gray-200 px-4 py-8 text-sm text-gray-400">
              Select another tab to prepare a live disconnect or reconnect action.
            </div>
          ) : !selectedCase ? (
            <div className="flex h-full items-center rounded-xl border border-dashed border-gray-200 px-4 py-8 text-sm text-gray-400">
              Pick a service case first.
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col space-y-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-blue-600">
                  {selectedCase.unit_status === 'disconnected' ? 'Reconnection record' : 'Disconnection record'}
                </p>
                <h2 className="mt-1 text-[1.6rem] font-semibold text-gray-900">
                  {selectedCase.building_code}-{selectedCase.unit_number}
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  {selectedCase.resident_name ?? 'No resident'} • {selectedCase.account_number ?? 'No account'}
                </p>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2">
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
                  <p className="text-xs font-medium uppercase tracking-[0.15em] text-gray-500">Outstanding</p>
                  <p className="mt-1 text-[1.9rem] font-semibold text-gray-900">
                    {php(selectedCase.outstanding_balance)}
                  </p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
                  <p className="text-xs font-medium uppercase tracking-[0.15em] text-gray-500">Unpaid periods</p>
                  <p className="mt-1 text-[1.9rem] font-semibold text-gray-900">
                    {selectedCase.unpaid_periods}
                  </p>
                </div>
              </div>

              {selectedCase.unit_status === 'disconnected' ? (
                selectedCase.can_reconnect ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                    Balance is clear. Record the reconnection once the meter has been reinstalled.
                  </div>
                ) : (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                    This unit stays disconnected until the remaining balance is cleared in Payment Queue.
                  </div>
                )
              ) : selectedCase.can_disconnect ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  This account is already eligible. Record the pull-out only after the meter has been removed.
                </div>
              ) : (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  This account is under watch only and is not yet eligible for disconnection.
                </div>
              )}

              <div className="grid gap-2.5">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Action date</label>
                  <input
                    type="date"
                    value={actionDate}
                    onChange={event => setActionDate(event.target.value)}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2.25 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Reason *</label>
                  <input
                    type="text"
                    value={reason}
                    onChange={event => setReason(event.target.value)}
                    placeholder={
                      selectedCase.unit_status === 'disconnected'
                        ? 'e.g. Obligations cleared and meter reinstalled'
                        : 'e.g. Second unpaid bill remained unsettled after grace period'
                    }
                    className="w-full rounded-xl border border-gray-300 px-3 py-2.25 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Notes</label>
                  <textarea
                    value={notes}
                    onChange={event => setNotes(event.target.value)}
                    rows={1}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Field findings, witness notes, staff names, meter condition, or reconnection remarks."
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Supporting evidence</h3>
                    <p className="mt-1 text-xs text-gray-500">Photos, bill copy, served notice, or clearance.</p>
                  </div>
                  <button
                    type="button"
                    onClick={chooseFiles}
                    className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-3.5 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    <FileUp size={15} />
                    Add files
                  </button>
                </div>

                <div className="mt-3 max-h-20 space-y-2 overflow-y-auto pr-1">
                  {pendingDocuments.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-300 px-3 py-4 text-sm text-gray-400">
                      No files staged yet.
                    </div>
                  ) : (
                    pendingDocuments.map((document, index) => (
                      <div
                        key={`${document.sourcePath}-${index}`}
                        className="rounded-xl border border-gray-200 bg-white p-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-gray-800">{document.originalName}</p>
                            <p className="mt-1 text-xs text-gray-500">{document.sourcePath}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => removePendingDocument(index)}
                            className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                          >
                            <X size={14} />
                          </button>
                        </div>

                        <div className="mt-3 grid gap-2">
                          <select
                            value={document.documentType}
                            onChange={event => updatePendingDocument(index, 'documentType', event.target.value)}
                            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            {DOCUMENT_TYPES.map(type => (
                              <option key={type.value} value={type.value}>
                                {type.label}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            value={document.notes}
                            onChange={event => updatePendingDocument(index, 'notes', event.target.value)}
                            placeholder="Optional note for this file"
                            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="mt-auto flex items-center justify-end gap-2 pt-1">
                {selectedCase.unit_status === 'disconnected' ? (
                  <button
                    type="button"
                    disabled={!canSubmitReconnect || saving}
                    onClick={() => setConfirmMode('reconnect')}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-200"
                  >
                    <RotateCcw size={15} />
                    Record Reconnection
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!canSubmitDisconnect || saving}
                    onClick={() => setConfirmMode('disconnect')}
                    className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-200"
                  >
                    <PlugZap size={15} />
                    Record Disconnection
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmMode === 'disconnect'}
        title="Record disconnection?"
        message="This will mark the unit as disconnected and save the attached evidence into the service-action log."
        confirmLabel={saving ? 'Saving...' : 'Confirm disconnection'}
        danger
        onCancel={() => !saving && setConfirmMode(null)}
        onConfirm={() => {
          if (!saving) {
            void submitAction();
          }
        }}
      />

      <ConfirmDialog
        open={confirmMode === 'reconnect'}
        title="Record reconnection?"
        message="This will restore the unit status to active and save the reconnection evidence into the service-action log."
        confirmLabel={saving ? 'Saving...' : 'Confirm reconnection'}
        onCancel={() => !saving && setConfirmMode(null)}
        onConfirm={() => {
          if (!saving) {
            void submitAction();
          }
        }}
      />
    </div>
  );
}
