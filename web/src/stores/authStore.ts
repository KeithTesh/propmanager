// web/src/stores/authStore.ts
/**
 * Auth store (Zustand)
 *
 * Holds the authenticated user + company in memory.
 * Access token is stored separately in tokenStore (lib/api.ts) —
 * not here, to avoid unnecessary re-renders on silent refresh.
 */

import { create } from 'zustand';
import type { AuthUser, Company } from '../types';
import { tokenStore } from '../lib/api';

interface AuthState {
  user: AuthUser | null;
  company: Company | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  setAuth: (user: AuthUser, company: Company | null, accessToken: string) => void;
  setCompany: (company: Company) => void;
  clearAuth: () => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  company: null,
  isAuthenticated: false,
  isLoading: true,  // true on mount — checking for existing session

  setAuth: (user, company, accessToken) => {
    tokenStore.set(accessToken);
    set({ user, company, isAuthenticated: true, isLoading: false });
  },

  setCompany: (company) => set({ company }),

  clearAuth: () => {
    tokenStore.clear();
    set({ user: null, company: null, isAuthenticated: false, isLoading: false });
  },

  setLoading: (loading) => set({ isLoading: loading }),
}));

// Convenience selectors
export const useUser = () => useAuthStore((s) => s.user);
export const useCompany = () => useAuthStore((s) => s.company);
export const useIsAuthenticated = () => useAuthStore((s) => s.isAuthenticated);
export const useAuthLoading = () => useAuthStore((s) => s.isLoading);