import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export interface ReadingRow {
  id: number;
  unit_id: number;
  unit_number: string;
  building_code: string;
  resident_name: string | null;
  previous_reading: number;
  current_reading: number | null;
  consumption: number | null;
  status: string;
  flag_reason: string | null;
  source: string;
}

export interface SyncImportResult {
  total: number;
  imported: number;
  duplicates: number;
  flagged: number;
  errors: string[];
}

interface ReadingState {
  readings: ReadingRow[];
  loading: boolean;
  cycleId: number | null;
  statusFilter: string | null;
  loadReadings: (cycleId: number, statusFilter?: string | null) => Promise<void>;
  approveReading: (readingId: number) => Promise<void>;
  flagReading: (readingId: number, flagReason: string) => Promise<void>;
  importReadings: (filePath: string) => Promise<SyncImportResult>;
}

export const useReadingStore = create<ReadingState>((set, get) => ({
  readings: [],
  loading: false,
  cycleId: null,
  statusFilter: null,

  loadReadings: async (cycleId, statusFilter = null) => {
    set({ loading: true, cycleId, statusFilter });
    try {
      const readings = await invoke<ReadingRow[]>('list_readings_for_cycle', {
        cycleId,
        statusFilter,
      });
      set({ readings });
    } finally {
      set({ loading: false });
    }
  },

  approveReading: async (readingId) => {
    await invoke('approve_reading', { readingId });
    if (get().cycleId) {
      await get().loadReadings(get().cycleId!, get().statusFilter);
    }
  },

  flagReading: async (readingId, flagReason) => {
    await invoke('flag_reading', { payload: { reading_id: readingId, flag_reason: flagReason } });
    if (get().cycleId) {
      await get().loadReadings(get().cycleId!, get().statusFilter);
    }
  },

  importReadings: async (filePath) => {
    const result = await invoke<SyncImportResult>('import_mobile_readings', { filePath });
    if (get().cycleId) {
      await get().loadReadings(get().cycleId!, get().statusFilter);
    }
    return result;
  },
}));
