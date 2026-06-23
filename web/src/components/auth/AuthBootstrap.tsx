// web/src/components/auth/AuthBootstrap.tsx

import { useEffect, useState } from 'react';
import axios from 'axios';
import { useAuthStore } from '../../stores/authStore';
import { tokenStore } from '../../lib/api';

interface RefreshResponse {
  success: boolean;
  data: {
    user: {
      id: string; companyId: string | null; role: string;
      email: string; fullName: string; phone: string | null; avatarUrl: string | null;
    };
    company: {
      id: string; name: string; tradingName: string | null; logoUrl: string | null;
      setupCompleted: boolean; setupCurrentStep: number; paymentMethod: string;
      accountType: string;
    } | null;
    tokens: { accessToken: string; expiresIn: number; };
  };
}

export function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const { setAuth, clearAuth } = useAuthStore();
  const [ready, setReady] = useState(false);

  async function restoreSession() {
    try {
      const res = await axios.post<RefreshResponse>(
        '/api/v1/auth/refresh', {}, { withCredentials: true }
      );
      const { user, company, tokens } = res.data.data;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setAuth(user as any, company as any, tokens.accessToken);

      // Schedule silent refresh 1 minute before token expires
      const refreshInMs = (tokens.expiresIn - 60) * 1000;
      if (refreshInMs > 0) {
        setTimeout(() => {
          // Only refresh if token is still the same one we set
          if (tokenStore.get() === tokens.accessToken) {
            restoreSession();
          }
        }, refreshInMs);
      }
    } catch {
      clearAuth();
    } finally {
      setReady(true);
    }
  }

  useEffect(() => {
    restoreSession();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) {
    return (
      <div style={{
        display: 'flex', height: '100vh', width: '100%',
        alignItems: 'center', justifyContent: 'center', backgroundColor: '#f9fafb',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 32, height: 32,
            border: '3px solid #0d9488', borderTopColor: 'transparent',
            borderRadius: '50%', animation: 'spin 0.8s linear infinite',
            margin: '0 auto 12px',
          }} />
          <p style={{ color: '#6b7280', fontSize: 14 }}>Loading…</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return <>{children}</>;
}