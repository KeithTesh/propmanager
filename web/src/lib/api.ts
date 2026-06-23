// web/src/lib/api.ts
/**
 * API client
 *
 * - Axios instance pointed at /api/v1 (proxied to Express in dev, direct in prod)
 * - Request interceptor: attaches Authorization: Bearer <access_token>
 * - Response interceptor: on 401, attempts silent token refresh then retries
 * - On refresh failure: clears auth state, redirects to login
 * - All error responses typed as ApiError
 */

import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import type { ApiError, AuthTokens } from '../types';

const BASE_URL = '/api/v1';

export const apiClient = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30_000,
  withCredentials: true,  // always send httpOnly refresh cookie
});

// ─── TOKEN STORAGE ────────────────────────────────────────────────────────────
// Stored in memory (not localStorage) to prevent XSS token theft.
// Refresh token stored in httpOnly cookie (set by API) — never readable by JS.

let _accessToken: string | null = null;
let _refreshPromise: Promise<string> | null = null;

export const tokenStore = {
  get:   () => _accessToken,
  set:   (token: string) => { _accessToken = token; },
  clear: () => { _accessToken = null; },
};

// ─── REQUEST INTERCEPTOR ─────────────────────────────────────────────────────

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = tokenStore.get();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ─── RESPONSE INTERCEPTOR ────────────────────────────────────────────────────

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiError>) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // On 401 — attempt silent refresh (once)
    // Skip retry for auth endpoints — they intentionally return 401 (wrong password, suspended, etc.)
    const isAuthEndpoint = original.url?.includes('/auth/login') || original.url?.includes('/auth/register');

    if (error.response?.status === 401 && !original._retry && !isAuthEndpoint) {
      original._retry = true;

      try {
        // If a refresh is already in flight (parallel requests), await the same promise
        if (!_refreshPromise) {
          _refreshPromise = refreshAccessToken().finally(() => {
            _refreshPromise = null;
          });
        }
        const newToken = await _refreshPromise;
        tokenStore.set(newToken);
        original.headers.Authorization = `Bearer ${newToken}`;
        return apiClient(original);
      } catch {
        // Refresh failed — log out only if we're not already on the login page
        tokenStore.clear();
        if (!window.location.pathname.includes('/login')) {
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  }
);

async function refreshAccessToken(): Promise<string> {
  // Refresh token is in httpOnly cookie — no JS access needed
  const response = await axios.post<{ data: AuthTokens }>('/api/v1/auth/refresh', {}, {
    withCredentials: true,  // sends the httpOnly cookie
  });
  return response.data.data.accessToken;
}

// ─── TYPED REQUEST HELPERS ───────────────────────────────────────────────────

export function extractData<T>(response: { data: { data: T } }): T {
  return response.data.data;
}

export function getApiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const apiError = error.response?.data as ApiError | undefined;
    return apiError?.error?.message ?? error.message;
  }
  if (error instanceof Error) return error.message;
  return 'An unexpected error occurred';
}

export function getApiErrorCode(error: unknown): string | null {
  if (axios.isAxiosError(error)) {
    const apiError = error.response?.data as ApiError | undefined;
    return apiError?.error?.code ?? null;
  }
  return null;
}