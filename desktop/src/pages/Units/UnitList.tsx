import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate } from 'react-router-dom';
import { Plus, ChevronRight } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { DataTable, type Column } from '../../components/shared/DataTable';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { php } from '../../utils/formatters';

interface Building {
  id: number;
  name: string;
  code: string;
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
  unit_number: string;
  meter_number: string | null;
  status: string;
  resident_name: string | null;
  account_number: string | null;
  outstanding_balance: number | null;
}

export function UnitList() {
  const { hasRole } = useAuthStore();
  const navigate = useNavigate();
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedBuilding, setSelectedBuilding] = useState<Building | null>(null);
  const [selectedFloor, setSelectedFloor] = useState<Floor | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const canManageUnits = hasRole('admin', 'billing_staff');

  useEffect(() => {
    invoke<Building[]>('list_buildings').then(setBuildings);
  }, []);

  const selectBuilding = async (building: Building) => {
    setSelectedBuilding(building);
    setSelectedFloor(null);
    setUnits([]);
    const data = await invoke<Floor[]>('list_floors', { buildingId: building.id });
    setFloors(data);
  };

  const selectFloor = async (floor: Floor) => {
    setSelectedFloor(floor);
    setLoading(true);
    const data = await invoke<Unit[]>('list_units', { floorId: floor.id });
    setUnits(data);
    setLoading(false);
  };

  const filtered = units.filter(unit =>
    !search ||
    unit.unit_number.toLowerCase().includes(search.toLowerCase()) ||
    unit.resident_name?.toLowerCase().includes(search.toLowerCase()) ||
    unit.account_number?.toLowerCase().includes(search.toLowerCase())
  );

  const unitColumns: Column<Unit>[] = [
    {
      key: 'unit',
      header: 'Unit',
      width: '80px',
      render: unit => <span className="font-mono font-medium text-gray-800">{unit.unit_number}</span>,
    },
    {
      key: 'resident',
      header: 'Resident',
      render: unit => unit.resident_name ?? <span className="text-gray-400 italic text-xs">No account</span>,
    },
    {
      key: 'account',
      header: 'Account No.',
      render: unit => <span className="font-mono text-xs text-gray-500">{unit.account_number ?? '-'}</span>,
    },
    {
      key: 'meter',
      header: 'Meter No.',
      render: unit => <span className="font-mono text-xs text-gray-500">{unit.meter_number ?? '-'}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: '100px',
      render: unit => <StatusBadge status={unit.status} />,
    },
    {
      key: 'balance',
      header: 'Balance',
      width: '120px',
      render: unit =>
        unit.outstanding_balance != null && unit.outstanding_balance > 0 ? (
          <span className="text-red-600 font-medium text-xs">{php(unit.outstanding_balance)}</span>
        ) : (
          <span className="text-gray-400 text-xs">-</span>
        ),
    },
  ];

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm text-gray-500">
          <span
            className={`cursor-pointer hover:text-gray-800 ${!selectedBuilding ? 'text-gray-900 font-medium' : ''}`}
            onClick={() => {
              setSelectedBuilding(null);
              setSelectedFloor(null);
              setUnits([]);
            }}
          >
            Buildings
          </span>
          {selectedBuilding && (
            <>
              <ChevronRight size={14} />
              <span
                className={`cursor-pointer hover:text-gray-800 ${!selectedFloor ? 'text-gray-900 font-medium' : ''}`}
                onClick={() => {
                  setSelectedFloor(null);
                  setUnits([]);
                }}
              >
                {selectedBuilding.code}
              </span>
            </>
          )}
          {selectedFloor && (
            <>
              <ChevronRight size={14} />
              <span className="text-gray-900 font-medium">Floor {selectedFloor.floor_number}</span>
            </>
          )}
        </div>
        <div className="flex gap-2">
          {selectedFloor && (
            <input
              type="text"
              placeholder="Search units..."
              value={search}
              onChange={event => setSearch(event.target.value)}
              className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
            />
          )}
          {canManageUnits && (
            <button
              onClick={() => navigate('/units/new')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus size={14} /> Add Unit
            </button>
          )}
        </div>
      </div>

      {!selectedBuilding && (
        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {buildings.map(building => (
            <button
              key={building.id}
              onClick={() => selectBuilding(building)}
              className="bg-white border border-gray-200 rounded-xl p-4 text-left hover:border-blue-300 hover:shadow-sm transition-all"
            >
              <p className="font-semibold text-gray-900 text-sm">{building.code}</p>
              <p className="text-xs text-gray-500 mt-1">{building.active_units} active</p>
              <p className="text-xs text-gray-400">{building.total_units} total</p>
            </button>
          ))}
        </div>
      )}

      {selectedBuilding && !selectedFloor && (
        <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
          {floors.map(floor => (
            <button
              key={floor.id}
              onClick={() => selectFloor(floor)}
              className="bg-white border border-gray-200 rounded-xl p-4 text-left hover:border-blue-300 hover:shadow-sm transition-all"
            >
              <p className="font-semibold text-gray-900 text-sm">Floor {floor.floor_number}</p>
              <p className="text-xs text-gray-500 mt-1">{floor.active_units} active / {floor.total_units} total</p>
            </button>
          ))}
        </div>
      )}

      {selectedFloor && (
        <div className="space-y-3">
          {!canManageUnits && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              Viewing only. Unit creation and edits are limited to admin and billing staff accounts.
            </div>
          )}
          <DataTable
            columns={unitColumns}
            data={filtered}
            rowKey={unit => unit.id}
            loading={loading}
            onRowClick={canManageUnits ? unit => navigate(`/units/new?unitId=${unit.id}`) : undefined}
            emptyMessage={search ? 'No units match your search.' : 'No units on this floor.'}
          />
        </div>
      )}
    </div>
  );
}
