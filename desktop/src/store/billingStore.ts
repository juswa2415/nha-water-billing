import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export interface BillingCycleRow {
  id: number;
  period_start: string;
  period_end: string;
  status: string;
  rate_per_cubicm: number;
  readings_approved: number;
  total_units: number;
  bills_generated: number;
}

export interface BillRow {
  id: number;
  account_number: string;
  resident_name: string;
  unit_number: string;
  building_code: string;
  total_amount_due: number;
  status: string;
}

interface BillingState {
  cycles: BillingCycleRow[];
  bills: BillRow[];
  selectedCycleId: number | null;
  loading: boolean;
  loadCycles: () => Promise<void>;
  selectCycle: (cycleId: number | null) => Promise<void>;
  loadBills: (cycleId?: number | null) => Promise<void>;
  generateBills: (cycleId: number) => Promise<void>;
}

export const useBillingStore = create<BillingState>((set, get) => ({
  cycles: [],
  bills: [],
  selectedCycleId: null,
  loading: false,

  loadCycles: async () => {
    set({ loading: true });
    try {
      const cycles = await invoke<BillingCycleRow[]>('list_billing_cycles');
      set({
        cycles,
        selectedCycleId: get().selectedCycleId ?? cycles[0]?.id ?? null,
      });
    } finally {
      set({ loading: false });
    }
  },

  selectCycle: async (cycleId) => {
    set({ selectedCycleId: cycleId });
    await get().loadBills(cycleId);
  },

  loadBills: async (cycleId) => {
    const effectiveCycleId = cycleId ?? get().selectedCycleId;
    if (!effectiveCycleId) {
      set({ bills: [] });
      return;
    }

    set({ loading: true });
    try {
      const bills = await invoke<BillRow[]>('list_bills_for_cycle', { cycleId: effectiveCycleId });
      set({ bills });
    } finally {
      set({ loading: false });
    }
  },

  generateBills: async (cycleId) => {
    set({ loading: true });
    try {
      await invoke('generate_bills_for_cycle', { cycleId });
      await get().loadBills(cycleId);
      await get().loadCycles();
    } finally {
      set({ loading: false });
    }
  },
}));
