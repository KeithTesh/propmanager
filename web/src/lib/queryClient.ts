// web/src/lib/queryClient.ts
import { QueryClient } from '@tanstack/react-query';
import { getApiErrorMessage } from './api';

// ─── QUERY CLIENT ─────────────────────────────────────────────────────────────

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:          1000 * 60 * 2,   // 2 minutes — Kenya mobile data is expensive
      gcTime:             1000 * 60 * 10,  // 10 minutes cache
      retry:              1,
      refetchOnWindowFocus: false,          // don't re-fetch when tab regains focus
      throwOnError:       false,
    },
    mutations: {
      onError: (error) => {
        console.error('Mutation error:', getApiErrorMessage(error));
      },
    },
  },
});

// ─── QUERY KEY FACTORY ────────────────────────────────────────────────────────
// Centralised keys prevent cache key typos and make invalidation predictable.

export const queryKeys = {
  // Auth
  me:           () => ['me'] as const,

  // Company
  company:      () => ['company'] as const,
  companies:    { list: () => ['companies'] as const },
  setupProgress:() => ['company', 'setup-progress'] as const,

  // Properties
  properties:   (filters?: Record<string, unknown>) => ['properties', filters] as const,
  property:     (id: string) => ['properties', id] as const,

  // Units
  units:        (propertyId?: string) => ['units', { propertyId }] as const,
  unit:         (id: string) => ['units', id] as const,

  // Tenants
  tenants:      (filters?: Record<string, unknown>) => ['tenants', filters] as const,
  tenant:       (id: string) => ['tenants', id] as const,

  // Leases
  leases:       (filters?: Record<string, unknown>) => ['leases', filters] as const,
  lease:        (id: string) => ['leases', id] as const,
  firstBillPreview: (moveInDate: string, rent: number) =>
    ['leases', 'first-bill-preview', { moveInDate, rent }] as const,

  // Billing
  bills:        (filters?: Record<string, unknown>) => ['bills', filters] as const,
  bill:         (id: string) => ['bills', id] as const,
  dashboard:    () => ['dashboard'] as const,

  // Payments
  payments:     (filters?: Record<string, unknown>) => ['payments', filters] as const,

  // Reconciliation
  csvBatches:   () => ['csv-batches'] as const,
  unmatchedPayments: (filters?: Record<string, unknown>) => ['unmatched-payments', filters] as const,
  csvTemplates: () => ['csv-templates'] as const,

  // Notifications
  notifications: (filters?: Record<string, unknown>) => ['notifications', filters] as const,

  // Maintenance
  maintenanceRequests: (filters?: Record<string, unknown>) => ['maintenance', filters] as const,
} as const;