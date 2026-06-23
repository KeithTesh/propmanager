// web/src/pages/landlords/LandlordsPage.tsx

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiClient, getApiErrorMessage } from '../../lib/api';
import { toast } from '../../components/ui/toaster';

interface Landlord {
  id: string; full_name: string; phone: string | null; email: string | null;
  kra_pin: string | null; bank_name: string | null; bank_account: string | null;
  bank_branch: string | null; commission_type: 'flat' | 'percentage';
  commission_value: number; status: string; notes: string | null;
  has_portal_access: boolean;
  property_count: number; unit_count: number; occupied_units: number;
  collected_this_month: number;
}

const inputCls = "w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition placeholder-gray-400";
const C = 'bg-white rounded-2xl border border-gray-100 shadow-sm';

// ─── Landlord Modal ───────────────────────────────────────────────────────────

function LandlordModal({ editing, onClose, onSaved }: {
  editing: Landlord | null; onClose: () => void; onSaved: () => void;
}) {
  const isEdit = !!editing;
  const [form, setForm] = useState({
    fullName:        editing?.full_name        ?? '',
    phone:           editing?.phone            ?? '',
    email:           editing?.email            ?? '',
    kraPin:          editing?.kra_pin          ?? '',
    bankName:        editing?.bank_name        ?? '',
    bankAccount:     editing?.bank_account     ?? '',
    bankBranch:      editing?.bank_branch      ?? '',
    commissionType:  editing?.commission_type  ?? 'percentage',
    commissionValue: String(editing?.commission_value ?? '10'),
    notes:           editing?.notes            ?? '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const f = (k: string) => (v: string) => setForm(p => ({ ...p, [k]: v }));

  async function submit() {
    if (!form.fullName.trim()) { setError('Full name is required'); return; }
    setLoading(true); setError('');
    try {
      const body = {
        fullName:        form.fullName.trim(),
        phone:           form.phone    || null,
        email:           form.email    || null,
        kraPin:          form.kraPin   || null,
        bankName:        form.bankName || null,
        bankAccount:     form.bankAccount || null,
        bankBranch:      form.bankBranch  || null,
        commissionType:  form.commissionType,
        commissionValue: parseFloat(form.commissionValue) || 10,
        notes:           form.notes || null,
      };
      if (isEdit) await apiClient.patch(`/landlords/${editing.id}`, body);
      else        await apiClient.post('/landlords', body);
      toast({ title: isEdit ? 'Landlord client updated' : 'Landlord client added', variant: 'success' });
      onSaved();
    } catch(e: any) { setError(getApiErrorMessage(e)); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">{isEdit ? 'Edit Landlord Client' : 'Add Landlord Client'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Full Name *</label>
              <input value={form.fullName} onChange={e => f('fullName')(e.target.value)} placeholder="John Kamau" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Phone</label>
              <input value={form.phone} onChange={e => f('phone')(e.target.value)} placeholder="0700 000 000" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Email</label>
              <input value={form.email} onChange={e => f('email')(e.target.value)} placeholder="john@email.com" type="email" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">KRA PIN</label>
              <input value={form.kraPin} onChange={e => f('kraPin')(e.target.value)} placeholder="A001234567K" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Bank Name</label>
              <input value={form.bankName} onChange={e => f('bankName')(e.target.value)} placeholder="KCB Bank" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Account Number</label>
              <input value={form.bankAccount} onChange={e => f('bankAccount')(e.target.value)} placeholder="0123456789" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Branch</label>
              <input value={form.bankBranch} onChange={e => f('bankBranch')(e.target.value)} placeholder="Westlands" className={inputCls} />
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Commission</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Type</label>
                <select value={form.commissionType} onChange={e => f('commissionType')(e.target.value)}
                  className={inputCls + ' bg-white'}>
                  <option value="percentage">Percentage of collected rent</option>
                  <option value="flat">Flat monthly fee (KES)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">
                  {form.commissionType === 'flat' ? 'Amount (KES)' : 'Rate (%)'}
                </label>
                <input type="number" min={0} value={form.commissionValue}
                  onChange={e => f('commissionValue')(e.target.value)}
                  placeholder={form.commissionType === 'flat' ? '5000' : '10'}
                  className={inputCls} />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Notes</label>
            <textarea value={form.notes} onChange={e => f('notes')(e.target.value)} rows={2}
              placeholder="Internal notes about this landlord client…"
              className={inputCls + ' resize-none'} />
          </div>
        </div>
        <div className="p-6 pt-0 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition">
            Cancel
          </button>
          <button onClick={submit} disabled={loading}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg,#0d9f9f,#076666)' }}>
            {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Landlord'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Invite Modal ─────────────────────────────────────────────────────────────

function InviteModal({ landlord, onClose }: { landlord: Landlord; onClose: () => void }) {
  const qc = useQueryClient();
  const [loading, setLoading]   = useState(false);
  const [result,  setResult]    = useState<{ loginEmail: string; tempPassword: string } | null>(null);
  const [error,   setError]     = useState('');

  async function sendInvite() {
    setLoading(true); setError('');
    try {
      const res: any = await apiClient.post(`/landlords/${landlord.id}/invite`);
      setResult(res.data.data);
      qc.invalidateQueries({ queryKey: ['landlords'] });
    } catch(e: any) { setError(getApiErrorMessage(e)); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-2">Invite to Landlord Portal</h2>
        {!result ? (
          <>
            <p className="text-sm text-gray-500 mb-5">
              This will create a read-only portal login for <strong>{landlord.full_name}</strong>.
              They'll receive their credentials via {landlord.phone ? 'SMS' : 'email'}.
            </p>
            {error && <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700">Cancel</button>
              <button onClick={sendInvite} disabled={loading}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg,#0d9f9f,#076666)' }}>
                {loading ? 'Sending…' : 'Send Invitation'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="p-4 rounded-xl bg-green-50 border border-green-200 mb-5">
              <p className="text-sm font-semibold text-green-800 mb-3">✅ Invitation sent!</p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Login Email</span>
                  <span className="font-mono font-semibold text-gray-900">{result.loginEmail}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Temp Password</span>
                  <span className="font-mono font-bold text-teal-700">{result.tempPassword}</span>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-3">Share with landlord: propmanager.co.ke/landlord-portal</p>
            </div>
            <button onClick={onClose} className="w-full py-2.5 rounded-xl text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(135deg,#0d9f9f,#076666)' }}>Done</button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LandlordsPage() {
  const qc       = useQueryClient();
  const navigate = useNavigate();
  const [showModal,  setShowModal]  = useState(false);
  const [editing,    setEditing]    = useState<Landlord | null>(null);
  const [inviting,   setInviting]   = useState<Landlord | null>(null);
  const [search,     setSearch]     = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['landlords'],
    queryFn: () => apiClient.get('/landlords').then((r: any) => r.data.data.landlords as Landlord[]),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/landlords/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['landlords'] }); toast({ title: 'Landlord client removed', variant: 'success' }); },
    onError: (e: any) => toast({ title: getApiErrorMessage(e), variant: 'error' }),
  });

  const landlords = (data ?? []).filter(l =>
    l.full_name.toLowerCase().includes(search.toLowerCase()) ||
    (l.phone ?? '').includes(search) ||
    (l.email ?? '').toLowerCase().includes(search.toLowerCase())
  );

  function handleDelete(l: Landlord) {
    if (!window.confirm(`Remove ${l.full_name} as a landlord client? This cannot be undone.`)) return;
    deleteMutation.mutate(l.id);
  }

  return (
    <div className="p-6 lg:p-8 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Landlord Clients</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage your landlord clients and their portfolios</p>
        </div>
        <button onClick={() => { setEditing(null); setShowModal(true); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition"
          style={{ background: 'linear-gradient(135deg,#0d9f9f,#076666)' }}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add Landlord
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Clients',    value: data?.length ?? 0,                              color: '#0d9f9f' },
          { label: 'Total Properties', value: data?.reduce((s, l) => s + l.property_count, 0) ?? 0, color: '#7c3aed' },
          { label: 'Total Units',      value: data?.reduce((s, l) => s + l.unit_count, 0)    ?? 0, color: '#2563eb' },
          { label: 'Portal Active',    value: data?.filter(l => l.has_portal_access).length  ?? 0, color: '#059669' },
        ].map(s => (
          <div key={s.label} className={`${C} p-4`}>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{s.label}</p>
            <p className="text-2xl font-bold" style={{ color: s.color }}>{Number(s.value).toLocaleString()}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <svg className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, phone or email…"
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : landlords.length === 0 ? (
        <div className={`${C} p-12 text-center`}>
          <div className="w-14 h-14 rounded-2xl bg-teal-50 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
          </div>
          <p className="font-semibold text-gray-700 mb-1">{search ? 'No clients found' : 'No landlord clients yet'}</p>
          <p className="text-sm text-gray-400">{search ? 'Try a different search' : 'Add your first landlord client to get started'}</p>
          {!search && (
            <button onClick={() => { setEditing(null); setShowModal(true); }}
              className="mt-4 px-4 py-2 rounded-lg text-sm font-semibold text-white"
              style={{ background: '#0d9f9f' }}>Add Landlord Client</button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {landlords.map(l => (
            <div key={l.id} className={`${C} p-5`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-gray-900">{l.full_name}</h3>
                    {l.has_portal_access && (
                      <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                        ✅ Portal Active
                      </span>
                    )}
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      l.commission_type === 'percentage'
                        ? 'bg-teal-50 text-teal-700'
                        : 'bg-purple-50 text-purple-700'
                    }`}>
                      {l.commission_type === 'percentage' ? `${l.commission_value}%` : `KES ${Number(l.commission_value).toLocaleString()} flat`}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-sm text-gray-500 flex-wrap">
                    {l.phone && <span>{l.phone}</span>}
                    {l.email && <span>{l.email}</span>}
                    {l.bank_name && <span>🏦 {l.bank_name}</span>}
                  </div>
                  {/* Portfolio stats */}
                  <div className="flex items-center gap-4 mt-3">
                    {[
                      { label: 'Properties', value: l.property_count },
                      { label: 'Units', value: l.unit_count },
                      { label: 'Occupied', value: l.occupied_units },
                      { label: 'Collected', value: `KES ${Number(l.collected_this_month).toLocaleString()}` },
                    ].map(s => (
                      <div key={s.label} className="text-center">
                        <p className="text-xs text-gray-400">{s.label}</p>
                        <p className="text-sm font-bold text-gray-800">{s.value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => navigate(`/landlords/${l.id}`)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 transition">
                    View
                  </button>
                  {!l.has_portal_access && (
                    <button onClick={() => setInviting(l)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 transition">
                      Invite
                    </button>
                  )}
                  <button onClick={() => { setEditing(l); setShowModal(true); }}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-700 bg-gray-50 hover:bg-gray-100 transition">
                    Edit
                  </button>
                  <button onClick={() => handleDelete(l)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 transition">
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      {(showModal || editing) && (
        <LandlordModal editing={editing} onClose={() => { setShowModal(false); setEditing(null); }}
          onSaved={() => { setShowModal(false); setEditing(null); qc.invalidateQueries({ queryKey: ['landlords'] }); }} />
      )}
      {inviting && <InviteModal landlord={inviting} onClose={() => setInviting(null)} />}
    </div>
  );
}