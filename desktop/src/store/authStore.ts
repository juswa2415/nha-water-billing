// src/store/authStore.ts
import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export type UserRole = 'admin' | 'billing_staff' | 'cashier' | 'field_staff';

export interface CurrentUser {
  id: number;
  username: string;
  full_name: string;
  role: UserRole;
}

interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
  hasRole: (...roles: UserRole[]) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: true,

  hydrate: async () => {
    try {
      const user = await invoke<CurrentUser | null>('get_current_user');
      set({ user, loading: false });
    } catch {
      set({ user: null, loading: false });
    }
  },

  login: async (username, password) => {
    const result = await invoke<{
      success: boolean;
      user: CurrentUser | null;
      error: string | null;
    }>('login', { payload: { username, password } });

    if (result.success && result.user) {
      set({ user: result.user });
      return { success: true };
    }
    return { success: false, error: result.error ?? 'Login failed.' };
  },

  logout: async () => {
    await invoke('logout');
    set({ user: null });
  },

  hasRole: (...roles) => {
    const user = get().user;
    return user ? roles.includes(user.role) : false;
  },
}));