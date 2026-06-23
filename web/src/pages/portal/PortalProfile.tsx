// web/src/pages/portal/PortalProfile.tsx

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, getApiErrorMessage } from '../../lib/api';

function fmt(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-50">
        <h2 className="font-semibold text-gray-900">{title}</h2>
      </div>
      <div className="px-5 py-5">{children}</div>
    </div>
  );
}

const inputCls = 'w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white';

export default function PortalProfile() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'profile' | 'vacate' | 'extension'>('profile');
  const [success, setSuccess] = useState('');
  const [err, setErr] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['portal-me'],
    queryFn: () => apiClient.get('/portal/me').then(r => r.data.data),
  });

  const tenant = data?.tenant;
  const lease  = tenant;

  // ── Profile form state
  const [form, setForm] = useState<Record<string, string>>({});
  const [notifySms,   setNotifySms]   = useState<boolean | null>(null);
  const [notifyEmail, setNotifyEmail] = useState<boolean | null>(null);

  // Sync form when data loads
  const profileForm = {
    fullName:   form.fullName   ?? tenant?.full_name   ?? '',
    phone:      form.phone      ?? tenant?.phone       ?? '',
    phoneMpesa: form.phoneMpesa ?? tenant?.phone_mpesa ?? '',
    email:      form.email      ?? tenant?.email       ?? '',
    nationalId: form.nationalId ?? tenant?.national_id ?? '',
  };
  const notifySmsVal   = notifySms   ?? tenant?.notify_sms   ?? true;
  const notifyEmailVal = notifyEmail ?? tenant?.notify_email ?? true;

  // ── Vacate form state
  const [vacateDate,   setVacateDate]   = useState('');
  const [vacateReason, setVacateReason] = useState('');

  // ── Extension form state
  const [extDate,    setExtDate]    = useState('');
  const [extMessage, setExtMessage] = useState('');

  const notify = (msg: string) => { setSuccess(msg); setErr(''); setTimeout(() => setSuccess(''), 4000); };

  const saveProfile = useMutation({
    mutationFn: () => apiClient.patch('/portal/profile', {
      fullName:    profileForm.fullName   || undefined,
      phone:       profileForm.phone      || undefined,
      phoneMpesa:  profileForm.phoneMpesa || undefined,
      email:       profileForm.email      || undefined,
      nationalId:  profileForm.nationalId || undefined,
      notifySms:   notifySmsVal,
      notifyEmail: notifyEmailVal,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['portal-me'] }); notify('Profile updated successfully'); },
    onError: (e: any) => setErr(getApiErrorMessage(e)),
  });

  const submitVacate = useMutation({
    mutationFn: () => apiClient.post('/portal/vacate', { vacateDate, reason: vacateReason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['portal-me'] }); notify('Vacate notice submitted — your property manager has been notified'); setVacateDate(''); setVacateReason(''); },
    onError: (e: any) => setErr(getApiErrorMessage(e)),
  });

  const submitExtension = useMutation({
    mutationFn: () => apiClient.post('/portal/lease-extension', { requestedEndDate: extDate, message: extMessage }),
    onSuccess: () => { notify('Extension request submitted — your property manager will review it'); setExtDate(''); setExtMessage(''); },
    onError: (e: any) => setErr(getApiErrorMessage(e)),
  });

  if (isLoading) return (
    <div className="flex items-center justify-center h-48">
      <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: '#0d9f9f', borderTopColor: 'transparent' }} />
    </div>
  );

  const hasVacateNotice = !!lease?.vacate_notice_date;
  const minVacateDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() + (lease?.notice_period_days ?? 30));
    return d.toISOString().slice(0, 10);
  })();

  return (
    <div className="space-y-4 pb-20 md:pb-6">
      <div className="mb-2">
        <h1 className="text-xl font-bold text-gray-900">My Profile</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your details and lease</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit text-sm">
        {([['profile','My Details'],['extension','Lease Extension'],['vacate','Vacate Notice']] as const).map(([k, label]) => (
          <button key={k} onClick={() => { setTab(k); setErr(''); setSuccess(''); }}
            className={`px-4 py-1.5 rounded-lg font-medium transition ${tab === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {success && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">✅ {success}</div>}
      {err     && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{err} <button onClick={() => setErr('')} className="ml-2 text-red-400">✕</button></div>}

      {/* ── Profile tab ── */}
      {tab === 'profile' && (
        <Section title="Personal Details">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
              <input className={inputCls} value={profileForm.fullName}
                onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input className={inputCls} value={profileForm.phone} placeholder="07XX XXX XXX"
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">M-Pesa Number</label>
              <input className={inputCls} value={profileForm.phoneMpesa} placeholder="07XX XXX XXX"
                onChange={e => setForm(f => ({ ...f, phoneMpesa: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input type="email" className={inputCls} value={profileForm.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">National ID</label>
              <input className={inputCls} value={profileForm.nationalId}
                onChange={e => setForm(f => ({ ...f, nationalId: e.target.value }))} />
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-gray-100">
            <p className="text-sm font-medium text-gray-700 mb-3">Notification Preferences</p>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="accent-teal-600" checked={notifySmsVal}
                  onChange={e => setNotifySms(e.target.checked)} />
                <span className="text-sm text-gray-700">SMS notifications</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="accent-teal-600" checked={notifyEmailVal}
                  onChange={e => setNotifyEmail(e.target.checked)} />
                <span className="text-sm text-gray-700">Email notifications</span>
              </label>
            </div>
          </div>

          <div className="mt-5 flex justify-end">
            <button onClick={() => saveProfile.mutate()} disabled={saveProfile.isPending}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition"
              style={{ background: '#0d9f9f' }}>
              {saveProfile.isPending ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </Section>
      )}

      {/* ── Lease Extension tab ── */}
      {tab === 'extension' && (
        <Section title="Request Lease Extension">
          {!lease?.lease_id ? (
            <p className="text-sm text-gray-500">No active lease found.</p>
          ) : (
            <>
              <div className="mb-4 p-3 rounded-xl bg-gray-50 border border-gray-100 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div><span className="text-gray-500">Current end date</span><br/>
                    <span className="font-semibold text-gray-900">{fmt(lease.end_date)}</span></div>
                  <div><span className="text-gray-500">Unit</span><br/>
                    <span className="font-semibold text-gray-900">{lease.unit_number} · {lease.property_name}</span></div>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Requested New End Date *</label>
                  <input type="date" className={inputCls} value={extDate}
                    min={lease.end_date?.slice(0, 10) ?? undefined}
                    onChange={e => setExtDate(e.target.value)} />
                  <p className="text-xs text-gray-400 mt-1">Must be after your current lease end date</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Message (optional)</label>
                  <textarea className={inputCls} rows={3} value={extMessage}
                    placeholder="Any additional context for your property manager…"
                    onChange={e => setExtMessage(e.target.value)} />
                </div>
                <div className="flex justify-end">
                  <button onClick={() => submitExtension.mutate()} disabled={submitExtension.isPending || !extDate}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition"
                    style={{ background: '#0d9f9f' }}>
                    {submitExtension.isPending ? 'Submitting…' : 'Submit Request'}
                  </button>
                </div>
              </div>
            </>
          )}
        </Section>
      )}

      {/* ── Vacate Notice tab ── */}
      {tab === 'vacate' && (
        <Section title="Submit Vacate Notice">
          {!lease?.lease_id ? (
            <p className="text-sm text-gray-500">No active lease found.</p>
          ) : hasVacateNotice ? (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800">
              <p className="font-semibold mb-1">✅ Vacate notice already submitted</p>
              <p>Notice served on: <strong>{fmt(lease.vacate_notice_date)}</strong></p>
              {lease.vacate_date && <p>Intended move-out: <strong>{fmt(lease.vacate_date)}</strong></p>}
              <p className="mt-2 text-xs text-amber-600">Contact your property manager if you need to change or cancel this notice.</p>
            </div>
          ) : (
            <>
              <div className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-100 text-sm text-amber-800">
                ⚠️ Once submitted, a vacate notice formally begins your notice period
                ({lease.notice_period_days ?? 30} days). Your property manager will be notified immediately.
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Intended Move-Out Date *</label>
                  <input type="date" className={inputCls} value={vacateDate}
                    min={minVacateDate}
                    onChange={e => setVacateDate(e.target.value)} />
                  <p className="text-xs text-gray-400 mt-1">
                    Must be at least {lease.notice_period_days ?? 30} days from today
                    (earliest: {fmt(minVacateDate)})
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reason (optional)</label>
                  <textarea className={inputCls} rows={3} value={vacateReason}
                    placeholder="Reason for moving out…"
                    onChange={e => setVacateReason(e.target.value)} />
                </div>
                <div className="flex justify-end">
                  <button onClick={() => submitVacate.mutate()} disabled={submitVacate.isPending || !vacateDate}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 transition">
                    {submitVacate.isPending ? 'Submitting…' : 'Submit Vacate Notice'}
                  </button>
                </div>
              </div>
            </>
          )}
        </Section>
      )}
    </div>
  );
}