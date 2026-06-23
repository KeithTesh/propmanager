// web/src/pages/auth/LoginPage.tsx

import { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { apiClient, extractData, getApiErrorMessage } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { PasswordInput } from '../../components/ui/PasswordInput';
import type { AuthUser, Company } from '../../types';

interface LoginResponse {
  user: AuthUser;
  company: Company | null;
  tokens: { accessToken: string; expiresIn: number };
}

type Screen = 'login' | 'forgot_phone' | 'forgot_code' | 'forgot_newpw' | 'forgot_done';

export default function LoginPage() {
  const navigate    = useNavigate();
  const location    = useLocation();
  const { setAuth, isAuthenticated, user } = useAuthStore();

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/dashboard';

  // Already authenticated — redirect away
  if (isAuthenticated && user) {
    if (user.role === 'caretaker') return <Navigate to="/caretaker" replace />;
    const dest = user.role === 'tenant' ? '/portal' : from === '/login' ? '/dashboard' : from;
    return <Navigate to={dest} replace />;
  }

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const [screen,    setScreen]    = useState<Screen>('login');
  const [fpPhone,   setFpPhone]   = useState('');
  const [fpCode,    setFpCode]    = useState('');
  const [fpToken,   setFpToken]   = useState('');
  const [fpNewPw,   setFpNewPw]   = useState('');
  const [fpNewPw2,  setFpNewPw2]  = useState('');
  const [fpError,   setFpError]   = useState('');
  const [fpLoading, setFpLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiClient.post<{ data: LoginResponse }>('/auth/login', {
        email: email.trim().toLowerCase(), password,
      }, { withCredentials: true });
      const { user, company, tokens } = extractData(res);
      queryClient.clear();
      setAuth(user, company, tokens.accessToken);
      if (user.role === 'caretaker') {
        navigate('/caretaker', { replace: true });
      } else if (user.role === 'tenant') {
        navigate('/portal', { replace: true });
      } else if (company && !company.setupCompleted) {
        navigate('/setup', { replace: true });
      } else {
        const safeTo = from.startsWith('/portal') ? '/dashboard' : from;
        navigate(safeTo, { replace: true });
      }
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotSend(e: React.FormEvent) {
    e.preventDefault();
    setFpError('');
    setFpLoading(true);
    try {
      await apiClient.post('/auth/forgot-password', { phone: fpPhone.trim() });
      setScreen('forgot_code');
    } catch (err) {
      setFpError(getApiErrorMessage(err));
    } finally {
      setFpLoading(false);
    }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setFpError('');
    setFpLoading(true);
    try {
      const res = await apiClient.post('/auth/verify-reset-code', {
        phone: fpPhone.trim(), code: fpCode.trim(),
      });
      setFpToken(res.data.data.resetToken);
      setScreen('forgot_newpw');
    } catch (err) {
      setFpError(getApiErrorMessage(err));
    } finally {
      setFpLoading(false);
    }
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setFpError('');
    if (fpNewPw !== fpNewPw2) { setFpError('Passwords do not match'); return; }
    if (fpNewPw.length < 8)   { setFpError('Password must be at least 8 characters'); return; }
    setFpLoading(true);
    try {
      await apiClient.post('/auth/reset-password', { resetToken: fpToken, newPassword: fpNewPw });
      setScreen('forgot_done');
    } catch (err) {
      setFpError(getApiErrorMessage(err));
    } finally {
      setFpLoading(false);
    }
  }

  function resetForgotFlow() {
    setScreen('login');
    setFpPhone(''); setFpCode(''); setFpToken('');
    setFpNewPw(''); setFpNewPw2(''); setFpError('');
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-900 via-brand-800 to-brand-600 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 backdrop-blur mb-4">
            <svg className="w-9 h-9 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">PropManager</h1>
          <p className="text-brand-200 mt-1 text-sm">Property management for Kenya</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">

          {screen === 'login' && (
            <>
              <h2 className="text-xl font-semibold text-gray-900 mb-6">Sign in to your account</h2>
              {error && <ErrorBanner message={error} />}
              <form onSubmit={handleSubmit} className="space-y-5">
                <Field label="Email address" id="email" type="email" autoComplete="email"
                  value={email} onChange={setEmail} placeholder="you@example.com" required />
                <Field label="Password" id="password" type="password" autoComplete="current-password"
                  value={password} onChange={setPassword} placeholder="••••••••" required />
                <SubmitButton loading={loading} label="Sign in" loadingLabel="Signing in…" />
              </form>
              <button onClick={() => setScreen('forgot_phone')}
                className="w-full mt-4 text-sm text-brand-600 hover:text-brand-700 font-medium text-center transition">
                Forgot password?
              </button>
            </>
          )}

          {screen === 'forgot_phone' && (
            <>
              <BackButton onClick={resetForgotFlow} />
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-gray-900">Reset your password</h2>
                <p className="text-sm text-gray-500 mt-1">Enter your registered phone number. We'll send a 6-digit code via SMS.</p>
              </div>
              {fpError && <ErrorBanner message={fpError} />}
              <form onSubmit={handleForgotSend} className="space-y-5">
                <Field label="Phone number" id="fp-phone" type="tel"
                  value={fpPhone} onChange={setFpPhone} placeholder="07xx xxx xxx" required />
                <SubmitButton loading={fpLoading} label="Send reset code" loadingLabel="Sending…" />
              </form>
            </>
          )}

          {screen === 'forgot_code' && (
            <>
              <BackButton onClick={() => setScreen('forgot_phone')} />
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-gray-900">Enter the code</h2>
                <p className="text-sm text-gray-500 mt-1">
                  We sent a 6-digit code to <strong>{fpPhone}</strong>. It expires in 10 minutes.
                </p>
              </div>
              {fpError && <ErrorBanner message={fpError} />}
              <form onSubmit={handleVerifyCode} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">6-digit code</label>
                  <input
                    type="text" inputMode="numeric" maxLength={6}
                    value={fpCode}
                    onChange={e => setFpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000" required
                    className="w-full text-center text-3xl font-bold tracking-[0.4em] px-3.5 py-3 rounded-lg border border-gray-300 text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500 transition"
                  />
                </div>
                <SubmitButton loading={fpLoading} label="Verify code" loadingLabel="Verifying…"
                  disabled={fpCode.length < 6} />
              </form>
              <button type="button"
                onClick={() => { setFpCode(''); setFpError(''); handleForgotSend({ preventDefault: () => {} } as any); }}
                className="w-full mt-3 text-sm text-gray-500 hover:text-gray-700 text-center">
                Didn't receive it? Resend code
              </button>
            </>
          )}

          {screen === 'forgot_newpw' && (
            <>
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-gray-900">Set new password</h2>
                <p className="text-sm text-gray-500 mt-1">Choose a strong password — at least 8 characters.</p>
              </div>
              {fpError && <ErrorBanner message={fpError} />}
              <form onSubmit={handleSetPassword} className="space-y-5">
                <Field label="New password" id="fp-newpw" type="password"
                  value={fpNewPw} onChange={setFpNewPw} placeholder="Min. 8 characters" required />
                <Field label="Confirm password" id="fp-newpw2" type="password"
                  value={fpNewPw2} onChange={setFpNewPw2} placeholder="Repeat password" required />
                <SubmitButton loading={fpLoading} label="Set new password" loadingLabel="Saving…" />
              </form>
            </>
          )}

          {screen === 'forgot_done' && (
            <div className="text-center py-4 space-y-4">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <div>
                <p className="text-lg font-bold text-gray-900">Password updated!</p>
                <p className="text-sm text-gray-500 mt-1">You can now sign in with your new password.</p>
              </div>
              <button onClick={resetForgotFlow}
                className="w-full py-2.5 px-4 rounded-lg text-white font-semibold text-sm transition"
                style={{ background: '#0d9f9f' }}>
                Back to sign in
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-brand-300 text-xs mt-6">
          PropManager © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2">
      <svg className="w-4 h-4 text-red-500 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
      </svg>
      <p className="text-sm text-red-700">{message}</p>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-5 transition">
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
      </svg>
      Back
    </button>
  );
}

function Field({ label, id, type, value, onChange, placeholder, required, autoComplete }: {
  label: string; id: string; type: string; value: string;
  onChange: (v: string) => void; placeholder: string;
  required?: boolean; autoComplete?: string;
}) {
  const inputCls = "w-full px-3.5 py-2.5 rounded-lg border border-gray-300 text-gray-900 placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition";

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      {type === 'password' ? (
        <PasswordInput id={id} autoComplete={autoComplete} required={required}
          value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          className={inputCls}
        />
      ) : (
        <input id={id} type={type} autoComplete={autoComplete} required={required}
          value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          className={inputCls}
        />
      )}
    </div>
  );
}

function SubmitButton({ loading, label, loadingLabel, disabled }: {
  loading: boolean; label: string; loadingLabel: string; disabled?: boolean;
}) {
  return (
    <button type="submit" disabled={loading || disabled}
      className="w-full py-2.5 px-4 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm transition disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2">
      {loading ? (
        <>
          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {loadingLabel}
        </>
      ) : label}
    </button>
  );
}