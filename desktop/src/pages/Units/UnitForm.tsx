import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { AlertTriangle, ArrowLeft, FileUp, ShieldCheck, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { StatusBadge } from '../../components/shared/StatusBadge';

interface Building {
  id: number;
  code: string;
  name: string;
}

interface Floor {
  id: number;
  floor_number: number;
}

interface UnitDetails {
  id: number;
  building_id: number;
  building_code: string;
  building_name: string;
  floor_id: number;
  floor_number: number;
  unit_number: string;
  meter_number: string | null;
  status: string;
  account_number: string | null;
  resident_name: string | null;
  contact_number: string | null;
}

interface UnitDocument {
  id: number;
  unit_id: number;
  document_type: string;
  original_name: string;
  stored_path: string;
  notes: string | null;
  uploaded_at: string;
}

interface StagedDocument {
  sourcePath: string;
  documentType: string;
  notes: string;
  originalName: string;
}

const EMPTY_FORM = {
  buildingId: '',
  floorId: '',
  unitNumber: '',
  meterNumber: '',
  status: 'active',
  residentName: '',
  contactNumber: '',
  accountNumber: '',
};

const DOCUMENT_TYPES = [
  { value: 'award_notice', label: 'Award Notice' },
  { value: 'government_id', label: 'Government ID' },
  { value: 'occupancy_clearance', label: 'Occupancy Clearance' },
  { value: 'turnover_acceptance', label: 'Turnover Acceptance' },
  { value: 'spa_authorization', label: 'SPA / Authorization' },
  { value: 'other', label: 'Other' },
];

function fileNameFromPath(path: string) {
  return path.split(/[/\\]/).pop() || path;
}

function formatUploadedAt(value: string) {
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

function buildEditRoute(unitId: number, returnTo: string) {
  const next = new URLSearchParams();
  next.set('unitId', String(unitId));
  next.set('returnTo', returnTo);
  return `/units/new?${next.toString()}`;
}

export function UnitForm() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const editId = params.get('unitId');
  const isEditMode = Boolean(editId);
  const requestedBuildingId = params.get('buildingId');
  const requestedFloorId = params.get('floorId');
  const returnTo = params.get('returnTo') || '/units';

  const [buildings, setBuildings] = useState<Building[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [reference, setReference] = useState<UnitDetails | null>(null);
  const [matchingUnit, setMatchingUnit] = useState<UnitDetails | null>(null);
  const [existingDocuments, setExistingDocuments] = useState<UnitDocument[]>([]);
  const [pendingDocuments, setPendingDocuments] = useState<StagedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;

    const loadFormContext = async () => {
      setLoading(true);

      try {
        if (isEditMode) {
          const unit = await invoke<UnitDetails>('get_unit', { unitId: Number(editId) });
          const [floorRows, documents] = await Promise.all([
            invoke<Floor[]>('list_floors', { buildingId: unit.building_id }),
            invoke<UnitDocument[]>('list_unit_documents', { unitId: Number(editId) }),
          ]);

          if (!active) return;

          setReference(unit);
          setFloors(floorRows);
          setExistingDocuments(documents);
          setForm({
            buildingId: String(unit.building_id),
            floorId: String(unit.floor_id),
            unitNumber: unit.unit_number,
            meterNumber: unit.meter_number ?? '',
            status: unit.status,
            residentName: unit.resident_name ?? '',
            contactNumber: unit.contact_number ?? '',
            accountNumber: unit.account_number ?? '',
          });
          return;
        }

        const buildingRows = await invoke<Building[]>('list_buildings');
        if (!active) return;
        setBuildings(buildingRows);

        if (requestedBuildingId) {
          const floorRows = await invoke<Floor[]>('list_floors', {
            buildingId: Number(requestedBuildingId),
          });

          if (!active) return;

          setFloors(floorRows);
          setForm(current => ({
            ...current,
            buildingId: requestedBuildingId,
            floorId: requestedFloorId ?? '',
          }));
        }
      } catch (error) {
        toast.error(`Unable to load unit form. ${String(error)}`);
        navigate(returnTo, { replace: true });
      } finally {
        if (active) setLoading(false);
      }
    };

    loadFormContext();

    return () => {
      active = false;
    };
  }, [editId, isEditMode, navigate, requestedBuildingId, requestedFloorId, returnTo]);

  useEffect(() => {
    if (isEditMode || !form.floorId || !form.unitNumber.trim()) {
      setMatchingUnit(null);
      return;
    }

    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const existing = await invoke<UnitDetails | null>('find_unit_on_floor', {
          floorId: Number(form.floorId),
          unitNumber: form.unitNumber.trim(),
        });
        if (active) setMatchingUnit(existing);
      } catch {
        if (active) setMatchingUnit(null);
      }
    }, 220);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [form.floorId, form.unitNumber, isEditMode]);

  const onBuildingChange = async (buildingId: string) => {
    setForm(current => ({ ...current, buildingId, floorId: '' }));
    setMatchingUnit(null);

    if (!buildingId) {
      setFloors([]);
      return;
    }

    const data = await invoke<Floor[]>('list_floors', { buildingId: Number(buildingId) });
    setFloors(data);
  };

  const setField = (key: keyof typeof EMPTY_FORM, value: string) => {
    setForm(current => ({ ...current, [key]: value }));
  };

  const openExistingUnit = () => {
    if (!matchingUnit) return;
    navigate(buildEditRoute(matchingUnit.id, returnTo));
  };

  const chooseDocuments = async () => {
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
            documentType: 'award_notice',
            notes: '',
            originalName: fileNameFromPath(path),
          }));

        return [...current, ...additions];
      });
    } catch (error) {
      toast.error(`Could not choose documents. ${String(error)}`);
    }
  };

  const updatePendingDocument = (
    index: number,
    key: keyof Pick<StagedDocument, 'documentType' | 'notes'>,
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

  const uploadPendingDocuments = async (unitId: number) => {
    for (const document of pendingDocuments) {
      await invoke('attach_unit_document', {
        payload: {
          unitId,
          sourcePath: document.sourcePath,
          documentType: document.documentType,
          notes: document.notes.trim() || null,
        },
      });
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);

    const meterNumber = form.meterNumber.trim();
    const residentName = form.residentName.trim();
    const contactNumber = form.contactNumber.trim();
    const accountNumber = form.accountNumber.trim();

    try {
      if (!isEditMode && matchingUnit) {
        toast('This unit already exists. Opening the existing record instead.', {
          icon: '↗',
        });
        openExistingUnit();
        return;
      }

      if (!isEditMode && pendingDocuments.length === 0) {
        toast.error('Attach at least one supporting document for a brand-new unit.');
        return;
      }

      let targetUnitId = editId ? Number(editId) : 0;

      if (isEditMode) {
        await invoke('update_unit', {
          payload: {
            id: Number(editId),
            meter_number: meterNumber || null,
            resident_name: residentName || null,
            contact_number: contactNumber || null,
            account_number: accountNumber || null,
            notes: null,
          },
        });
      } else {
        targetUnitId = await invoke<number>('create_unit', {
          payload: {
            floor_id: Number(form.floorId),
            unit_number: form.unitNumber.trim(),
            meter_number: meterNumber || null,
            status: form.status,
            resident_name: residentName || null,
            contact_number: contactNumber || null,
            account_number: accountNumber || null,
          },
        });
      }

      if (pendingDocuments.length > 0) {
        try {
          await uploadPendingDocuments(targetUnitId);
        } catch (error) {
          toast.error(`Unit saved, but document upload failed. ${String(error)}`);
          navigate(buildEditRoute(targetUnitId, returnTo));
          return;
        }
      }

      toast.success(isEditMode ? 'Unit updated.' : 'Unit created.');
      navigate(returnTo);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setSaving(false);
    }
  };

  const labelCls = 'mb-1.5 block text-xs font-medium text-gray-600';
  const inputCls =
    'w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
  const lockedCls = 'rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700';
  const selectedDocumentTypes = useMemo(
    () => pendingDocuments.map(document => document.documentType),
    [pendingDocuments]
  );

  if (loading) {
    return <div className="p-8 text-sm text-gray-400">Loading unit details...</div>;
  }

  return (
    <div className="max-w-4xl space-y-4">
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => navigate(returnTo)}
          className="inline-flex items-center gap-2 text-sm text-gray-500 transition-colors hover:text-gray-800"
        >
          <ArrowLeft size={15} />
          Back to unit directory
        </button>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-blue-600">
              Unit Record
            </p>
            <h1 className="text-2xl font-semibold text-gray-900">
              {isEditMode ? 'Update unit and tenant' : 'Create or assign a unit'}
            </h1>
          </div>

          {!isEditMode && form.buildingId && form.floorId && (
            <div className="inline-flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">
              <ShieldCheck size={15} />
              Started from a selected floor
            </div>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">
                {isEditMode ? 'Unit reference' : 'Unit location'}
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                {isEditMode
                  ? 'Building, floor, and unit number stay fixed here.'
                  : 'Choose the exact floor and unit slot before saving.'}
              </p>
            </div>
            {reference && <StatusBadge status={reference.status} />}
          </div>

          {isEditMode && reference ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Building</label>
                <div className={lockedCls}>
                  {reference.building_code} - {reference.building_name}
                </div>
              </div>
              <div>
                <label className={labelCls}>Floor</label>
                <div className={lockedCls}>Floor {reference.floor_number}</div>
              </div>
              <div>
                <label className={labelCls}>Unit Number</label>
                <div className={lockedCls}>{reference.unit_number}</div>
              </div>
              <div>
                <label className={labelCls}>Meter Number</label>
                <input
                  className={inputCls}
                  value={form.meterNumber}
                  onChange={event => setField('meterNumber', event.target.value)}
                  placeholder="Serial number"
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Building *</label>
                <select
                  className={inputCls}
                  value={form.buildingId}
                  onChange={event => onBuildingChange(event.target.value)}
                  required
                >
                  <option value="">Select building...</option>
                  {buildings.map(building => (
                    <option key={building.id} value={building.id}>
                      {building.code} - {building.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Floor *</label>
                <select
                  className={inputCls}
                  value={form.floorId}
                  onChange={event => setField('floorId', event.target.value)}
                  required
                  disabled={!form.buildingId}
                >
                  <option value="">Select floor...</option>
                  {floors.map(floor => (
                    <option key={floor.id} value={floor.id}>
                      Floor {floor.floor_number}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Unit Number *</label>
                <input
                  className={inputCls}
                  value={form.unitNumber}
                  onChange={event => setField('unitNumber', event.target.value)}
                  placeholder="e.g. 407"
                  required
                />
              </div>
              <div>
                <label className={labelCls}>Meter Number</label>
                <input
                  className={inputCls}
                  value={form.meterNumber}
                  onChange={event => setField('meterNumber', event.target.value)}
                  placeholder="Serial number"
                />
              </div>
              <div>
                <label className={labelCls}>Starting Status</label>
                <select
                  className={inputCls}
                  value={form.status}
                  onChange={event => setField('status', event.target.value)}
                >
                  <option value="active">Active</option>
                  <option value="vacant">Vacant</option>
                  <option value="inactive">Inactive</option>
                  <option value="disconnected">Disconnected</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {!isEditMode && matchingUnit && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-amber-900">
                  <AlertTriangle size={15} />
                  This unit already exists
                </p>
                <p className="text-sm text-amber-900">
                  {matchingUnit.resident_name
                    ? `Current tenant: ${matchingUnit.resident_name}`
                    : 'No tenant is attached yet. Open the existing record to assign or update the tenant.'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={matchingUnit.status} />
                <button
                  type="button"
                  onClick={openExistingUnit}
                  className="rounded-xl border border-amber-300 bg-white px-3.5 py-2 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-100"
                >
                  Open Existing Unit
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-gray-900">Tenant / Account</h2>
            <p className="mt-1 text-sm text-gray-500">
              Keep the current tenant details here. Saving a tenant on a vacant unit will create the
              missing account automatically.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={labelCls}>Resident Name</label>
              <input
                className={inputCls}
                value={form.residentName}
                onChange={event => setField('residentName', event.target.value)}
                placeholder="SURNAME, First Name"
              />
            </div>
            <div>
              <label className={labelCls}>Contact Number</label>
              <input
                className={inputCls}
                value={form.contactNumber}
                onChange={event => setField('contactNumber', event.target.value)}
                placeholder="09XX-XXX-XXXX"
              />
            </div>
            <div>
              <label className={labelCls}>
                {reference?.account_number ? 'Account Number' : 'Account Number (optional)'}
              </label>
              {isEditMode && reference?.account_number ? (
                <div className={lockedCls}>{reference.account_number}</div>
              ) : (
                <input
                  className={inputCls}
                  value={form.accountNumber}
                  onChange={event => setField('accountNumber', event.target.value)}
                  placeholder="Auto-generated if blank"
                />
              )}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Supporting documents</h2>
              <p className="mt-1 text-sm text-gray-500">
                Store legal and turnover files with this unit record.
              </p>
            </div>
            <button
              type="button"
              onClick={chooseDocuments}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-3.5 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
            >
              <FileUp size={15} />
              Add Files
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {DOCUMENT_TYPES.slice(0, 5).map(type => (
              <span
                key={type.value}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                  selectedDocumentTypes.includes(type.value)
                    ? 'bg-blue-50 text-blue-700'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                {type.label}
              </span>
            ))}
          </div>

          <p className="mt-3 text-xs text-gray-500">
            New unit creation requires at least one supporting file.
          </p>

          <div className="mt-4 space-y-3">
            {existingDocuments.map(document => (
              <div
                key={document.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">{document.original_name}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {DOCUMENT_TYPES.find(type => type.value === document.document_type)?.label ??
                      document.document_type}
                    {' / '}
                    {formatUploadedAt(document.uploaded_at)}
                  </p>
                </div>
                <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-gray-500">
                  Stored
                </span>
              </div>
            ))}

            {pendingDocuments.map((document, index) => (
              <div key={document.sourcePath} className="rounded-xl border border-blue-100 bg-blue-50/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{document.originalName}</p>
                    <p className="mt-1 text-xs text-gray-500">Will be attached after save.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removePendingDocument(index)}
                    className="rounded-lg border border-gray-200 bg-white p-1.5 text-gray-500 transition-colors hover:text-gray-700"
                    aria-label="Remove file"
                  >
                    <X size={14} />
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-[0.75fr_1.25fr] gap-3">
                  <select
                    className={inputCls}
                    value={document.documentType}
                    onChange={event =>
                      updatePendingDocument(index, 'documentType', event.target.value)
                    }
                  >
                    {DOCUMENT_TYPES.map(type => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className={inputCls}
                    value={document.notes}
                    onChange={event => updatePendingDocument(index, 'notes', event.target.value)}
                    placeholder="Optional notes"
                  />
                </div>
              </div>
            ))}

            {existingDocuments.length === 0 && pendingDocuments.length === 0 && (
              <div className="rounded-xl border border-dashed border-gray-300 px-4 py-5 text-sm text-gray-500">
                No documents attached yet.
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => navigate(returnTo)}
            className="rounded-xl border border-gray-300 px-5 py-2.5 text-sm text-gray-600 transition-colors hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
          >
            {saving
              ? 'Saving...'
              : matchingUnit && !isEditMode
                  ? 'Open Existing Unit'
                  : isEditMode
                      ? 'Save Unit Record'
                      : 'Create Unit'}
          </button>
        </div>
      </form>
    </div>
  );
}
