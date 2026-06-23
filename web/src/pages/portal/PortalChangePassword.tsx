// web/src/pages/portal/PortalChangePassword.tsx

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient, getApiErrorMessage } from '../../lib/api';
import { PasswordInput } from '../../components/ui/PasswordInput';

export default function PortalChangePassword() {
  const navigate = useNavigate();

  const [current,  setCurrent]  = useState('');
  const [newPw,    setNewPw]    = useState('');
  const [newPw2,   setNewPw2]   = useState('');
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState(false);
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (newPw !== newPw2) {
      setError('New passwords do not match');
      return;
    }
    if (newPw.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (newPw === current) {
      setError('New password must be different from your current password');
      return;
    }

    setLoading(true);
    try {
      await apiClient.post('/auth/change-password', {
        currentPassword: current,
        newPassword: newPw,
      });
      setSuccess(true);
      setCurrent(''); setNewPw(''); setNewPw2('');
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/portal')}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <h1 className="text-xl font-bold text-gray-900">Change Password</h1>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        {success ? (
          <div className="text-center py-4 space-y-4">
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto">
              <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <div>
              <p className="font-bold text-gray-900">Password changed!</p>
              <p className="text-sm text-gray-500 mt-1">Your password has been updated successfully.</p>
            </div>
            <button onClick={() => navigate('/portal')}
              className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition"
              style={{ background: '#0d9f9f' }}>
              Back to overview
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-600">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-semibold text-gray-600 mb-1.5">Current password</label>
              <PasswordInput
                value={current}
                onChange={e => setCurrent(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="Your current password"
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 transition"
              />
            </div>

            <div className="border-t border-gray-50 pt-4">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-600 mb-1.5">New password</label>
                  <PasswordInput
                    value={newPw}
                    onChange={e => setNewPw(e.target.value)}
                    required
                    autoComplete="new-password"
                    placeholder="Min. 8 characters"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 transition"
                  />
                  {/* Password strength indicator */}
                  {newPw && (
                    <div className="mt-2 flex gap-1">
                      {[...Array(4)].map((_, i) => (
                        <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${
                          newPw.length >= [8, 10, 12, 14][i]
                            ? i < 1 ? 'bg-red-400' : i < 2 ? 'bg-amber-400' : i < 3 ? 'bg-blue-400' : 'bg-green-400'
                            : 'bg-gray-200'
                        }`} />
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-600 mb-1.5">Confirm new password</label>
                  <PasswordInput
                    value={newPw2}
                    onChange={e => setNewPw2(e.target.value)}
                    required
                    autoComplete="new-password"
                    placeholder="Repeat new password"
                    className={`w-full px-3.5 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 transition ${
                      newPw2 && newPw !== newPw2 ? 'border-red-300 bg-red-50' : 'border-gray-200'
                    }`}
                  />
                  {newPw2 && newPw !== newPw2 && (
                    <p className="text-xs text-red-500 mt-1">Passwords don't match</p>
                  )}
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !current || !newPw || !newPw2}
              className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition"
              style={{ background: '#0d9f9f' }}>
              {loading ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )}
      </div>

      <div className="bg-amber-50 rounded-2xl border border-amber-100 p-4 text-xs text-amber-700 space-y-1">
        <p className="font-semibold">Password tips:</p>
        <p>• Use at least 8 characters</p>
        <p>• Mix uppercase, lowercase, numbers</p>
        <p>• Avoid using your name or phone number</p>
        <p>• Don't reuse passwords from other accounts</p>
      </div>
    </div>
  );
}