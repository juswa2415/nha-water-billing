import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';

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

export function UnitForm() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const editId = params.get('unitId');
  const isEditMode = Boolean(editId);

  const [buildings, setBuildings] = useState<Building[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [reference, setReference] = useState<UnitDetails | null>(null);
  const [loading, setLoading] = useState(isEditMode);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isEditMode) return;
    invoke<Building[]>('list_buildings')
      .then(setBuildings)
      .catch(error => toast.error(String(error)));
  }, [isEditMode]);

  useEffect(() => {
    if (!editId) return;

    let active = true;

    const loadUnit = async () => {
      setLoading(true);

      try {
        const unit = await invoke<UnitDetails>('get_unit', { unitId: Number(editId) });
        const floorRows = await invoke<Floor[]>('list_floors', { buildingId: unit.building_id });

        if (!active) return;

        setReference(unit);
        setFloors(floorRows);
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
      } catch (error) {
        toast.error(`Unable to load unit. ${String(error)}`);
        navigate('/units', { replace: true });
      } finally {
        if (active) setLoading(false);
      }
    };

    loadUnit();

    return () => {
      active = false;
    };
  }, [editId, navigate]);

  const onBuildingChange = async (buildingId: string) => {
    setForm(current => ({ ...current, buildingId, floorId: '' }));

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

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);

    const meterNumber = form.meterNumber.trim();
    const residentName = form.residentName.trim();
    const contactNumber = form.contactNumber.trim();
    const accountNumber = form.accountNumber.trim();

    try {
      if (isEditMode) {
        await invoke('update_unit', {
          payload: {
            id: Number(editId),
            meter_number: meterNumber || null,
            resident_name: residentName || null,
            contact_number: contactNumber || null,
            notes: null,
          },
        });
      } else {
        await invoke('create_unit', {
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

      toast.success(isEditMode ? 'Unit updated.' : 'Unit created.');
      navigate('/units');
    } catch (error) {
      toast.error(String(error));
    } finally {
      setSaving(false);
    }
  };

  const labelCls = 'block text-xs font-medium text-gray-600 mb-1.5';
  const inputCls = 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500';
  const selectCls = inputCls;
  const lockedCls = 'rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700';

  if (loading) {
    return <div className="text-sm text-gray-400 p-8">Loading unit details...</div>;
  }

  return (
    <div className="max-w-2xl">
      <form onSubmit={handleSubmit} className="space-y-6">
        {isEditMode && reference ? (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-800 mb-4">Locked Unit Reference</h3>
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
                  <label className={labelCls}>Status</label>
                  <div className={lockedCls}>{reference.status.replace('_', ' ')}</div>
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Account Number</label>
                  <div className={lockedCls}>{reference.account_number ?? 'No assigned account'}</div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              Building, floor, unit number, status, and account identifiers are locked during routine edits.
              Use an approved admin process with supporting documents for transfers, renumbering, status changes,
              or account reassignment.
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-4">Unit Location</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Building *</label>
                <select
                  className={selectCls}
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
                  className={selectCls}
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
                <label className={labelCls}>Status</label>
                <select
                  className={selectCls}
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
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-800 mb-4">
            {isEditMode ? 'Allowed Updates' : 'Resident Account'}
          </h3>
          <div className="grid grid-cols-2 gap-4">
            {isEditMode && (
              <div>
                <label className={labelCls}>Meter Number</label>
                <input
                  className={inputCls}
                  value={form.meterNumber}
                  onChange={event => setField('meterNumber', event.target.value)}
                  placeholder="Serial number"
                />
              </div>
            )}
            <div className="col-span-2">
              {reference?.account_number || !isEditMode ? (
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
                  {!isEditMode && (
                    <div>
                      <label className={labelCls}>Account Number</label>
                      <input
                        className={inputCls}
                        value={form.accountNumber}
                        onChange={event => setField('accountNumber', event.target.value)}
                        placeholder="Auto-generated if blank"
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
                  No resident account is currently attached to this unit. Account assignment is restricted to
                  approved create/import workflows.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => navigate('/units')}
            className="px-5 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 font-medium"
          >
            {saving ? 'Saving...' : isEditMode ? 'Update Allowed Fields' : 'Create Unit'}
          </button>
        </div>
      </form>
    </div>
  );
}
