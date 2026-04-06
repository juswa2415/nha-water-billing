import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  DoorOpen,
  HousePlus,
  Layers3,
  Plus,
  Search,
  Upload,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { DataTable, type Column } from '../../components/shared/DataTable';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { php } from '../../utils/formatters';

interface Building {
  id: number;
  name: string;
  code: string;
  total_floors: number;
  sub_meter_number: string | null;
  notes: string | null;
  active_units: number;
  total_units: number;
}

interface Floor {
  id: number;
  floor_number: number;
  active_units: number;
  total_units: number;
}

interface Unit {
  id: number;
  building_id: number;
  building_code: string;
  building_name: string;
  floor_id: number;
  floor_number: number;
  unit_number: string;
  meter_number: string | null;
  status: string;
  resident_name: string | null;
  account_number: string | null;
  outstanding_balance: number | null;
}

const RESERVED_BLOCKS = ['BLDG-A', 'BLDG-B', 'BLDG-C', 'BLDG-D'];

export function UnitList() {
  const { hasRole } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [search, setSearch] = useState('');
  const [loadingBuildings, setLoadingBuildings] = useState(true);
  const [loadingFloors, setLoadingFloors] = useState(false);
  const [loadingUnits, setLoadingUnits] = useState(false);
  const canManageUnits = hasRole('admin', 'billing_staff');
  const canImport = hasRole('admin');

  const buildingIdParam = params.get('buildingId');
  const floorIdParam = params.get('floorId');

  const selectedBuilding =
    buildings.find(building => String(building.id) === buildingIdParam) ?? null;
  const selectedFloor =
    floors.find(floor => String(floor.id) === floorIdParam) ?? null;

  useEffect(() => {
    const loadBuildings = async () => {
      setLoadingBuildings(true);
      try {
        const data = await invoke<Building[]>('list_buildings');
        setBuildings(data);
      } finally {
        setLoadingBuildings(false);
      }
    };

    loadBuildings();
  }, []);

  useEffect(() => {
    const loadFloors = async () => {
      if (!buildingIdParam) {
        setFloors([]);
        setUnits([]);
        return;
      }

      setLoadingFloors(true);
      setSelectedFloorSearchReset();
      try {
        const data = await invoke<Floor[]>('list_floors', {
          buildingId: Number(buildingIdParam),
        });
        setFloors(data);
      } finally {
        setLoadingFloors(false);
      }
    };

    loadFloors();
  }, [buildingIdParam]);

  useEffect(() => {
    const loadUnits = async () => {
      if (!floorIdParam) {
        setUnits([]);
        return;
      }

      setLoadingUnits(true);
      try {
        const data = await invoke<Unit[]>('list_units', {
          floorId: Number(floorIdParam),
        });
        setUnits(data);
      } finally {
        setLoadingUnits(false);
      }
    };

    loadUnits();
  }, [floorIdParam]);

  function setSelectedFloorSearchReset() {
    setSearch('');
  }

  const totalBuildings = buildings.length;
  const totalUnits = buildings.reduce((sum, building) => sum + building.total_units, 0);
  const activeUnits = buildings.reduce((sum, building) => sum + building.active_units, 0);
  const vacantUnits = Math.max(totalUnits - activeUnits, 0);
  const reservedBlocks = RESERVED_BLOCKS.filter(
    code => !buildings.some(building => building.code.toUpperCase() === code)
  );

  const filteredUnits = units.filter(unit => {
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return (
      unit.unit_number.toLowerCase().includes(needle) ||
      unit.resident_name?.toLowerCase().includes(needle) ||
      unit.account_number?.toLowerCase().includes(needle) ||
      unit.meter_number?.toLowerCase().includes(needle)
    );
  });

  const activeOnFloor = units.filter(unit => unit.status === 'active').length;
  const vacantOnFloor = units.filter(unit => unit.status === 'vacant').length;

  const returnTo = `${location.pathname}${location.search}`;

  const unitColumns: Column<Unit>[] = [
    {
      key: 'unit',
      header: 'Unit',
      width: '92px',
      render: unit => (
        <div>
          <p className="font-mono font-semibold text-gray-900">{unit.unit_number}</p>
          <p className="text-[11px] text-gray-400">Floor {unit.floor_number}</p>
        </div>
      ),
    },
    {
      key: 'resident',
      header: 'Resident',
      render: unit =>
        unit.resident_name ?? (
          <span className="text-xs italic text-gray-400">No attached account</span>
        ),
    },
    {
      key: 'account',
      header: 'Account',
      width: '130px',
      render: unit => (
        <span className="font-mono text-xs text-gray-500">
          {unit.account_number ?? 'Unassigned'}
        </span>
      ),
    },
    {
      key: 'meter',
      header: 'Meter',
      width: '120px',
      render: unit => (
        <span className="font-mono text-xs text-gray-500">
          {unit.meter_number ?? 'No meter yet'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '120px',
      render: unit => <StatusBadge status={unit.status} />,
    },
    {
      key: 'balance',
      header: 'Balance',
      width: '130px',
      render: unit =>
        unit.outstanding_balance != null && unit.outstanding_balance > 0 ? (
          <span className="text-xs font-medium text-red-600">
            {php(unit.outstanding_balance)}
          </span>
        ) : (
          <span className="text-xs text-gray-400">Clear</span>
        ),
    },
  ];

  const selectBuilding = (building: Building) => {
    setParams({ buildingId: String(building.id) });
  };

  const selectFloor = (floor: Floor) => {
    if (!selectedBuilding) return;
    setParams({
      buildingId: String(selectedBuilding.id),
      floorId: String(floor.id),
    });
  };

  const openCreateUnit = () => {
    const next = new URLSearchParams();
    if (selectedBuilding) next.set('buildingId', String(selectedBuilding.id));
    if (selectedFloor) next.set('floorId', String(selectedFloor.id));
    next.set('returnTo', returnTo);
    navigate(`/units/new?${next.toString()}`);
  };

  const openEditUnit = (unit: Unit) => {
    const next = new URLSearchParams();
    next.set('unitId', String(unit.id));
    next.set('returnTo', returnTo);
    navigate(`/units/new?${next.toString()}`);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-blue-600">
            Unit Directory
          </p>
          <h1 className="text-2xl font-semibold text-gray-900">Unit Management</h1>
          <p className="max-w-3xl text-sm text-gray-500">
            Monitor building occupancy, review floor-level portfolios, and update tenant-facing unit
            details without losing your place in the directory.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canImport && (
            <Link
              to="/units/import"
              className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
            >
              <Upload size={15} />
              Bulk Import
            </Link>
          )}
          {canManageUnits && selectedFloor && (
            <button
              onClick={openCreateUnit}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              <Plus size={15} />
              Add Unit
            </button>
          )}
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-4">
        <SummaryCard
          icon={<Building2 size={18} />}
          label="Registered Buildings"
          value={String(totalBuildings)}
          note={`${reservedBlocks.length} reserved blocks ready for future setup`}
          tone="blue"
        />
        <SummaryCard
          icon={<DoorOpen size={18} />}
          label="Total Units"
          value={String(totalUnits)}
          note={`${activeUnits} active portfolio-wide`}
          tone="emerald"
        />
        <SummaryCard
          icon={<HousePlus size={18} />}
          label="Vacant / Inactive"
          value={String(vacantUnits)}
          note="Open inventory for turnover or expansion"
          tone="amber"
        />
        <SummaryCard
          icon={<Layers3 size={18} />}
          label="Current View"
          value={
            selectedFloor
              ? `${selectedBuilding?.code} / F${selectedFloor.floor_number}`
              : selectedBuilding
                  ? selectedBuilding.code
                  : 'All Buildings'
          }
          note={
            selectedFloor
              ? `${filteredUnits.length} units shown`
              : selectedBuilding
                  ? `${floors.length} floors in view`
                  : 'Choose a building to drill in'
          }
          tone="slate"
        />
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
            <button
              onClick={() => setParams({})}
              className={`rounded-lg px-2.5 py-1 transition-colors ${
                !selectedBuilding ? 'bg-gray-100 font-medium text-gray-900' : 'hover:bg-gray-50'
              }`}
            >
              Buildings
            </button>
            {selectedBuilding && (
              <>
                <ArrowRight size={14} className="text-gray-300" />
                <button
                  onClick={() => setParams({ buildingId: String(selectedBuilding.id) })}
                  className={`rounded-lg px-2.5 py-1 transition-colors ${
                    !selectedFloor ? 'bg-gray-100 font-medium text-gray-900' : 'hover:bg-gray-50'
                  }`}
                >
                  {selectedBuilding.code}
                </button>
              </>
            )}
            {selectedFloor && (
              <>
                <ArrowRight size={14} className="text-gray-300" />
                <span className="rounded-lg bg-gray-100 px-2.5 py-1 font-medium text-gray-900">
                  Floor {selectedFloor.floor_number}
                </span>
              </>
            )}
          </div>

          {selectedFloor ? (
            <div className="relative w-full max-w-xs">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                placeholder="Search unit, resident, account, meter..."
                value={search}
                onChange={event => setSearch(event.target.value)}
                className="w-full rounded-xl border border-gray-300 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          ) : (
            <p className="text-xs text-gray-400">
              {selectedBuilding
                ? 'Open a floor to inspect or edit units.'
                : 'Use the building dashboard to navigate the portfolio.'}
            </p>
          )}
        </div>

        {!selectedBuilding && (
          <div className="space-y-6 pt-5">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {loadingBuildings
                ? Array.from({ length: 6 }).map((_, index) => (
                    <div
                      key={`skeleton-${index}`}
                      className="h-48 animate-pulse rounded-2xl border border-gray-200 bg-gray-50"
                    />
                  ))
                : buildings.map(building => (
                    <BuildingCard
                      key={building.id}
                      building={building}
                      onClick={() => selectBuilding(building)}
                    />
                  ))}
            </div>

            {reservedBlocks.length > 0 && (
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Reserved Letter Blocks</h3>
                  <p className="mt-1 text-xs text-gray-500">
                    Placeholder blocks shown now so the directory reflects future letter-based
                    expansion. These stay vacant until formally created in admin setup.
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {reservedBlocks.map(code => (
                    <div
                      key={code}
                      className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-base font-semibold text-slate-800">{code}</p>
                        <span className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-slate-500">
                          Reserved
                        </span>
                      </div>
                      <p className="mt-3 text-sm text-slate-600">0 active units</p>
                      <p className="text-xs text-slate-400">Future letter-block inventory</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {selectedBuilding && !selectedFloor && (
          <div className="space-y-5 pt-5">
            <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-gray-100 bg-gradient-to-r from-slate-50 via-white to-blue-50 p-5">
              <div className="space-y-1">
                <button
                  onClick={() => setParams({})}
                  className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800"
                >
                  <ArrowLeft size={14} />
                  Back to all buildings
                </button>
                <h2 className="text-xl font-semibold text-gray-900">
                  {selectedBuilding.code} / {selectedBuilding.name}
                </h2>
                <p className="max-w-2xl text-sm text-gray-500">
                  Review floor occupancy, locate vacant or inactive units, and open a floor only when
                  you need to manage actual tenant records.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <InlineMetric label="Floors" value={String(selectedBuilding.total_floors)} />
                <InlineMetric label="Active" value={String(selectedBuilding.active_units)} />
                <InlineMetric
                  label="Vacant"
                  value={String(
                    Math.max(selectedBuilding.total_units - selectedBuilding.active_units, 0)
                  )}
                />
                <InlineMetric label="Total Units" value={String(selectedBuilding.total_units)} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {loadingFloors
                ? Array.from({ length: 4 }).map((_, index) => (
                    <div
                      key={`floor-skeleton-${index}`}
                      className="h-40 animate-pulse rounded-2xl border border-gray-200 bg-gray-50"
                    />
                  ))
                : floors.map(floor => (
                    <FloorCard
                      key={floor.id}
                      floor={floor}
                      onOpen={() => selectFloor(floor)}
                    />
                  ))}
            </div>
          </div>
        )}

        {selectedBuilding && selectedFloor && (
          <div className="space-y-4 pt-5">
            <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-gray-100 bg-gray-50 p-5">
              <div className="space-y-1">
                <button
                  onClick={() => setParams({ buildingId: String(selectedBuilding.id) })}
                  className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800"
                >
                  <ArrowLeft size={14} />
                  Back to {selectedBuilding.code}
                </button>
                <h2 className="text-xl font-semibold text-gray-900">
                  {selectedBuilding.code} / Floor {selectedFloor.floor_number}
                </h2>
                <p className="text-sm text-gray-500">
                  Routine edits stay contextual here. Add new units only from the floor where they
                  belong.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <InlineMetric label="Shown" value={String(filteredUnits.length)} />
                <InlineMetric label="Active" value={String(activeOnFloor)} />
                <InlineMetric label="Vacant" value={String(vacantOnFloor)} />
              </div>
            </div>

            {!canManageUnits && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Viewing only. Unit creation and edits are limited to admin and billing staff.
              </div>
            )}

            <DataTable
              columns={unitColumns}
              data={filteredUnits}
              rowKey={unit => unit.id}
              loading={loadingUnits}
              onRowClick={canManageUnits ? openEditUnit : undefined}
              emptyMessage={
                search
                  ? 'No units match your search on this floor.'
                  : 'No units are registered on this floor yet.'
              }
            />
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  note,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  note: string;
  tone: 'blue' | 'emerald' | 'amber' | 'slate';
}) {
  const toneStyles = {
    blue: 'border-blue-100 bg-blue-50/70 text-blue-700',
    emerald: 'border-emerald-100 bg-emerald-50/70 text-emerald-700',
    amber: 'border-amber-100 bg-amber-50/70 text-amber-700',
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
  }[tone];

  return (
    <div className={`rounded-2xl border p-4 ${toneStyles}`}>
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-3 text-2xl font-semibold text-gray-900">{value}</p>
      <p className="mt-1 text-xs text-gray-500">{note}</p>
    </div>
  );
}

function BuildingCard({
  building,
  onClick,
}: {
  building: Building;
  onClick: () => void;
}) {
  const occupancy =
    building.total_units > 0 ? Math.round((building.active_units / building.total_units) * 100) : 0;
  const vacant = Math.max(building.total_units - building.active_units, 0);

  return (
    <button
      onClick={onClick}
      className="group rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-gray-900">{building.code}</p>
          <p className="mt-1 text-sm text-gray-500">{building.name}</p>
        </div>
        <div className="rounded-full bg-blue-50 p-2 text-blue-600 transition-colors group-hover:bg-blue-100">
          <Building2 size={18} />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <MetricPill label="Floors" value={String(building.total_floors)} />
        <MetricPill label="Vacant" value={String(vacant)} />
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
          <span>Occupancy</span>
          <span>{occupancy}% active</span>
        </div>
        <div className="h-2 rounded-full bg-gray-100">
          <div
            className="h-2 rounded-full bg-blue-600 transition-all"
            style={{ width: `${occupancy}%` }}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm">
        <div>
          <p className="font-medium text-gray-900">{building.active_units} active units</p>
          <p className="text-xs text-gray-400">{building.total_units} total registered</p>
        </div>
        <span className="inline-flex items-center gap-1 text-blue-700">
          Open <ArrowRight size={14} />
        </span>
      </div>
    </button>
  );
}

function FloorCard({
  floor,
  onOpen,
}: {
  floor: Floor;
  onOpen: () => void;
}) {
  const occupancy =
    floor.total_units > 0 ? Math.round((floor.active_units / floor.total_units) * 100) : 0;
  const vacant = Math.max(floor.total_units - floor.active_units, 0);

  return (
    <button
      onClick={onOpen}
      className="rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-sm transition-all hover:border-blue-200 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-semibold text-gray-900">Floor {floor.floor_number}</p>
          <p className="mt-1 text-xs text-gray-500">Open the unit portfolio for this floor.</p>
        </div>
        <div className="rounded-full bg-gray-50 p-2 text-gray-500">
          <DoorOpen size={18} />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <MetricPill label="Active" value={String(floor.active_units)} />
        <MetricPill label="Vacant" value={String(vacant)} />
        <MetricPill label="Total" value={String(floor.total_units)} />
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
          <span>Floor occupancy</span>
          <span>{occupancy}%</span>
        </div>
        <div className="h-2 rounded-full bg-gray-100">
          <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${occupancy}%` }} />
        </div>
      </div>
    </button>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-gray-50 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function InlineMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[88px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-center">
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-gray-900">{value}</p>
    </div>
  );
}

