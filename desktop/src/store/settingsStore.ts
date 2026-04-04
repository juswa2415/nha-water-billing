import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export interface SettingRow {
  key: string;
  value: string;
  description: string | null;
}

interface SettingsState {
  settings: Record<string, string>;
  loading: boolean;
  load: () => Promise<void>;
  get: (key: string) => string | undefined;
  save: (key: string, value: string) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: {},
  loading: false,

  load: async () => {
    set({ loading: true });
    try {
      const rows = await invoke<SettingRow[]>('list_settings');
      const settings = rows.reduce<Record<string, string>>((acc, row) => {
        acc[row.key] = row.value;
        return acc;
      }, {});
      set({ settings });
    } finally {
      set({ loading: false });
    }
  },

  get: (key) => get().settings[key],

  save: async (key, value) => {
    await invoke('update_setting', { payload: { key, value } });
    set((state) => ({ settings: { ...state.settings, [key]: value } }));
  },
}));
