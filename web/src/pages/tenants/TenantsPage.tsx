// web/src/pages/tenants/TenantsPage.tsx

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiClient, getApiErrorMessage } from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Tenant {
  id: string; full_name: string; phone: string; email: string | null;
  national_id: string | null; is_corporate: boolean; company_name: string | null;
  notes: string | null; notify_sms: boolean; notify_email: boolean;
  active_leases: string; unit_number: string | null; property_name: string | null;
  created_at: string; user_id: string | null;
}

interface TenantForm {
  fullName: string; phone: string; email: string; phoneMpesa: string;
  nationalId: string; kraPin: string; isCorporate: boolean; companyName: string;
  emergencyContactName: string; emergencyContactPhone: string;
  notes: string; notifySms: boolean; notifyEmail: boolean;
}

const EMPTY: TenantForm = {
  fullName:'', phone:'', email:'', phoneMpesa:'', nationalId:'', kraPin:'',
  isCorporate:false, companyName:'', emergencyContactName:'', emergencyContactPhone:'',
  notes:'', notifySms:true, notifyEmail:false,
};

const inputCls = "w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition placeholder-gray-400";

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ name, size = 8 }: { name: string; size?: number }) {
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  const colors = ['#0d9f9f','#6366f1','#f59e0b','#10b981','#ef4444','#8b5cf6','#ec4899'];
  const color  = colors[name.charCodeAt(0) % colors.length];
  const px     = size * 4;
  return (
    <div style={{ width:px, height:px, borderRadius:'50%', background:color,
      display:'flex', alignItems:'center', justifyContent:'center',
      fontSize: px * 0.35, fontWeight:700, color:'white', flexShrink:0 }}>
      {initials}
    </div>
  );
}

// ─── Tenant Card ──────────────────────────────────────────────────────────────

function TenantCard({ t, onEdit, onArchive, onInvite }: {
  t: Tenant; onEdit:(t:Tenant)=>void; onArchive:(t:Tenant)=>void; onInvite:(t:Tenant)=>void;
}) {
  const hasLease = parseInt(t.active_leases) > 0;


  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md hover:border-gray-200 transition-all group overflow-hidden">
      <div className="h-1" style={{ background: hasLease ? 'linear-gradient(90deg,#0d9f9f,#076666)' : '#e5e7eb' }} />
      <div className="p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar name={t.full_name} size={10} />
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 truncate">{t.full_name}</p>
              <p className="text-xs text-gray-400 mt-0.5">{t.phone}</p>
            </div>
          </div>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            onClick={e => e.stopPropagation()}>

            {!t.user_id ? (
              <button onClick={() => onInvite(t)} title="Send portal access"
                className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
              </button>
            ) : (
              <span title="Portal access active" className="p-1.5 inline-flex text-green-500">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                </svg>
              </span>
            )}
            <button onClick={() => onEdit(t)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-teal-600 hover:bg-teal-50 transition">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
              </svg>
            </button>
            {!hasLease && (
              <button onClick={() => onArchive(t)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Status badges */}
        <div className="flex flex-wrap gap-2 mt-3">
          {hasLease ? (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
              Active tenant
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
              No active lease
            </span>
          )}
          {t.is_corporate && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
              Corporate
            </span>
          )}
        </div>

        {/* Current unit */}
        {hasLease && t.unit_number && (
          <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75" />
            </svg>
            <span className="text-xs text-gray-500 truncate">
              Unit {t.unit_number}{t.property_name ? ` · ${t.property_name}` : ''}
            </span>
          </div>
        )}

        {t.email && (
          <p className="text-xs text-gray-400 mt-2 truncate">{t.email}</p>
        )}
      </div>
    </div>
  );
}

// ─── Tenant Modal ─────────────────────────────────────────────────────────────

function TenantModal({ editing, onClose, onSaved }: {
  editing: Tenant | null; onClose:()=>void; onSaved:()=>void;
}) {
  const [form, setForm] = useState<TenantForm>(editing ? {
    fullName: editing.full_name, phone: editing.phone, email: editing.email ?? '',
    phoneMpesa: '', nationalId: editing.national_id ?? '', kraPin: '',
    isCorporate: editing.is_corporate, companyName: editing.company_name ?? '',
    emergencyContactName: '', emergencyContactPhone: '',
    notes: editing.notes ?? '', notifySms: editing.notify_sms, notifyEmail: editing.notify_email,
  } : EMPTY);
  const [tab, setTab]       = useState<'basic'|'extra'>('basic');
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const set = (k: keyof TenantForm, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));

  async function submit() {
    if (!form.fullName.trim()) { setError('Full name is required'); return; }
    if (!form.phone.trim())    { setError('Phone number is required'); return; }
    setError(''); setLoading(true);
    try {
      const payload = {
        fullName:              form.fullName.trim(),
        phone:                 form.phone.trim(),
        email:                 form.email || null,
        phoneMpesa:            form.phoneMpesa || null,
        nationalId:            form.nationalId || null,
        kraPin:                form.kraPin || null,
        isCorporate:           form.isCorporate,
        companyName:           form.companyName || null,
        emergencyContactName:  form.emergencyContactName || null,
        emergencyContactPhone: form.emergencyContactPhone || null,
        notes:                 form.notes || null,
        notifySms:             form.notifySms,
        notifyEmail:           form.notifyEmail,
      };
      editing ? await apiClient.patch(`/tenants/${editing.id}`, payload)
              : await apiClient.post('/tenants', payload);
      onSaved();
    } catch(e) { setError(getApiErrorMessage(e)); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background:'rgba(0,0,0,0.4)', backdropFilter:'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">
            {editing ? 'Edit Tenant' : 'Add Tenant'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100">
          {(['basic', 'extra'] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); setError(''); }}
              className={`flex-1 py-2.5 text-sm font-medium transition border-b-2
                ${tab === t ? 'border-teal-500 text-teal-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
              {t === 'basic' ? 'Basic Info' : 'Extra Details'}
            </button>
          ))}
        </div>

        <div className="p-6 space-y-4 max-h-96 overflow-y-auto">
          {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}

          {tab === 'basic' ? (
            <>
              {/* Corporate toggle */}
              <label className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 cursor-pointer hover:bg-gray-50 transition">
                <input type="checkbox" checked={form.isCorporate}
                  onChange={e => set('isCorporate', e.target.checked)}
                  className="w-4 h-4 rounded accent-teal-500" />
                <div>
                  <p className="text-sm font-medium text-gray-800">Corporate tenant</p>
                  <p className="text-xs text-gray-400">Company leasing the unit</p>
                </div>
              </label>

              {form.isCorporate && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Company Name *</label>
                  <input value={form.companyName} onChange={e => set('companyName', e.target.value)}
                    placeholder="Acme Ltd" className={inputCls} />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {form.isCorporate ? 'Contact Person Name' : 'Full Name'} *
                </label>
                <input value={form.fullName} onChange={e => set('fullName', e.target.value)}
                  placeholder="John Kamau" className={inputCls} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Phone *</label>
                  <input value={form.phone} onChange={e => set('phone', e.target.value)}
                    placeholder="+254 700 000 000" className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">M-Pesa Phone</label>
                  <input value={form.phoneMpesa} onChange={e => set('phoneMpesa', e.target.value)}
                    placeholder="If different from phone" className={inputCls} />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
                <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                  placeholder="john@email.com" className={inputCls} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">National ID</label>
                  <input value={form.nationalId} onChange={e => set('nationalId', e.target.value)}
                    placeholder="12345678" className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">KRA PIN</label>
                  <input value={form.kraPin} onChange={e => set('kraPin', e.target.value)}
                    placeholder="A000000000X" className={inputCls} />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Emergency Contact</label>
                  <input value={form.emergencyContactName}
                    onChange={e => set('emergencyContactName', e.target.value)}
                    placeholder="Jane Kamau" className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Emergency Phone</label>
                  <input value={form.emergencyContactPhone}
                    onChange={e => set('emergencyContactPhone', e.target.value)}
                    placeholder="+254 700 000 000" className={inputCls} />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes</label>
                <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
                  rows={3} placeholder="Any notes about this tenant…"
                  className={inputCls + ' resize-none'} />
              </div>

              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Notifications</p>
                <div className="flex gap-3">
                  <label className={`flex-1 flex items-center gap-2 p-3 rounded-xl border-2 cursor-pointer transition
                    ${form.notifySms ? 'border-teal-500 bg-teal-50' : 'border-gray-200 hover:border-gray-300'}`}>
                    <input type="checkbox" checked={form.notifySms}
                      onChange={e => set('notifySms', e.target.checked)}
                      className="accent-teal-500" />
                    <span className="text-sm font-medium text-gray-700">SMS</span>
                  </label>
                  <label className={`flex-1 flex items-center gap-2 p-3 rounded-xl border-2 cursor-pointer transition
                    ${form.notifyEmail ? 'border-teal-500 bg-teal-50' : 'border-gray-200 hover:border-gray-300'}`}>
                    <input type="checkbox" checked={form.notifyEmail}
                      onChange={e => set('notifyEmail', e.target.checked)}
                      className="accent-teal-500" />
                    <span className="text-sm font-medium text-gray-700">Email</span>
                  </label>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition">
            Cancel
          </button>
          <button onClick={submit} disabled={loading}
            className="px-5 py-2 rounded-lg text-sm font-semibold text-white transition disabled:opacity-60 flex items-center gap-2"
            style={{ background:'#0d9f9f' }}>
            {loading && <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
            {editing ? 'Save Changes' : 'Add Tenant'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Archive Modal ────────────────────────────────────────────────────────────

function ArchiveModal({ t, onClose, onDone }: { t:Tenant; onClose:()=>void; onDone:()=>void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  async function archive() {
    setLoading(true); setError('');
    try { await apiClient.delete(`/tenants/${t.id}`); onDone(); }
    catch(e) { setError(getApiErrorMessage(e)); setLoading(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background:'rgba(0,0,0,0.4)', backdropFilter:'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-2">Archive {t.full_name}?</h3>
        <p className="text-sm text-gray-500">This tenant will be hidden but their history is preserved. Tenants with active leases cannot be archived.</p>
        {error && <div className="mt-3 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
        <div className="flex justify-end gap-3 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition">Cancel</button>
          <button onClick={archive} disabled={loading}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition disabled:opacity-60 flex items-center gap-2">
            {loading && <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
            Archive
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function TenantsPage() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editing,   setEditing]   = useState<Tenant | null>(null);
  const [archiving, setArchiving] = useState<Tenant | null>(null);
  const [inviting, setInviting]   = useState<Tenant | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteResult, setInviteResult]   = useState<{email:string;password:string}|null>(null);
  const [search,    setSearch]    = useState('');
  const debouncedSearch = useDebounce(search, 500);
  const [filter,    setFilter]    = useState<'all'|'active'|'inactive'>('all');

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['tenants', debouncedSearch],
    queryFn: async () => {
      const params = debouncedSearch ? `?search=${encodeURIComponent(debouncedSearch)}` : '';
      const res = await apiClient.get<{ data: { tenants: Tenant[] } }>(`/tenants${params}`);
      return res.data.data.tenants;
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ['tenants'] });
    setShowModal(false); setEditing(null); setArchiving(null); setInviting(null); setInviteResult(null);
  }

  const tenants = (data ?? []).filter(t =>
    filter === 'all'      ? true :
    filter === 'active'   ? parseInt(t.active_leases) > 0 :
                            parseInt(t.active_leases) === 0
  );

  const activeCount   = (data ?? []).filter(t => parseInt(t.active_leases) > 0).length;
  const inactiveCount = (data ?? []).filter(t => parseInt(t.active_leases) === 0).length;

  async function handleInvite(tenant: Tenant) {
    setInviteLoading(true);
    try {
      const res: any = await apiClient.post(`/tenants/${tenant.id}/invite`);
      setInviteResult({ email: res.data.data.loginEmail, password: res.data.data.tempPassword });
      qc.invalidateQueries({ queryKey: ['tenants'] });
    } catch(e: any) {
      alert(getApiErrorMessage(e));
      setInviting(null);
    }
    setInviteLoading(false);
  }

  return (
    <div className="p-6 lg:p-8 ">

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tenants</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {data ? `${data?.length ?? 0} ${(data?.length ?? 0) === 1 ? 'tenant' : 'tenants'}` : 'Loading…'}
          </p>
        </div>
        <button onClick={() => { setEditing(null); setShowModal(true); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm hover:shadow-md transition"
          style={{ background:'linear-gradient(135deg,#0d9f9f,#076666)' }}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add Tenant
        </button>
      </div>

      {/* Search + Filter — always visible */}
      {(
        <div className="flex gap-3 mb-6">
          <div style={{ position:'relative', flex:1 }}>
            <svg style={{ position:'absolute', left:'0.875rem', top:'50%', transform:'translateY(-50%)',
              width:'1rem', height:'1rem', color:'#9ca3af', pointerEvents:'none' }}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, phone, email, ID…"
              style={{ width:'100%', paddingLeft:'2.5rem', paddingRight:'1rem',
                paddingTop:'0.625rem', paddingBottom:'0.625rem',
                borderRadius:'0.75rem', border:'1px solid #e5e7eb',
                fontSize:'0.875rem', outline:'none', background:'white' }}
              onFocus={e => { e.target.style.boxShadow='0 0 0 2px #0d9f9f'; e.target.style.borderColor='transparent'; }}
              onBlur={e =>  { e.target.style.boxShadow='none'; e.target.style.borderColor='#e5e7eb'; }} />
          </div>
          <div className="flex gap-2">
            {([
              { k:'all',      label:`All (${data?.length ?? 0})` },
              { k:'active',   label:`Active (${activeCount})` },
              { k:'inactive', label:`No lease (${inactiveCount})` },
            ] as const).map(f => (
              <button key={f.k} onClick={() => setFilter(f.k)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition whitespace-nowrap
                  ${filter === f.k ? 'text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'}`}
                style={filter === f.k ? { background:'#0d9f9f' } : {}}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
            style={{ borderColor:'#0d9f9f', borderTopColor:'transparent' }} />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !debouncedSearch && (data ?? []).length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ background:'linear-gradient(135deg,#e6fafa,#b2eded)' }}>
            <svg className="w-8 h-8" style={{ color:'#0d9f9f' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-gray-900 mb-1">No tenants yet</h3>
          <p className="text-sm text-gray-500 mb-5">Add your first tenant to get started</p>
          <button onClick={() => { setEditing(null); setShowModal(true); }}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ background:'#0d9f9f' }}>
            Add First Tenant
          </button>
        </div>
      )}

      {/* Grid */}
      {!isLoading && tenants.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {tenants.map(t => (
            <TenantCard key={t.id} t={t}
              onEdit={tenant => { setEditing(tenant); setShowModal(true); }}
              onArchive={tenant => setArchiving(tenant)}
              onInvite={tenant => { setInviting(tenant); setInviteResult(null); }} />
          ))}
        </div>
      )}

      {/* No results from search */}
      {!isLoading && !isFetching && debouncedSearch && tenants.length === 0 && (
        <div className="text-center py-16">
          <p className="text-2xl mb-2">🔍</p>
          <p className="text-sm font-medium text-gray-700">No tenant found for "{debouncedSearch}"</p>
          <p className="text-xs text-gray-400 mt-1">Try searching by name, phone, email or national ID</p>
        </div>
      )}

      {/* Modals */}
      {(showModal || editing) && (
        <TenantModal editing={editing}
          onClose={() => { setShowModal(false); setEditing(null); }}
          onSaved={refresh} />
      )}
      {inviting && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
            {!inviteResult ? (
              <>
                <h2 className="text-lg font-bold text-gray-900 mb-2">Send Portal Access</h2>
                <p className="text-sm text-gray-500 mb-6">
                  This will create a login for <strong>{inviting.full_name}</strong> and send credentials via SMS{inviting.email ? ' and email' : ''}.
                </p>
                <div className="flex gap-3">
                  <button onClick={() => setInviting(null)}
                    className="flex-1 px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 transition">
                    Cancel
                  </button>
                  <button onClick={() => handleInvite(inviting)} disabled={inviteLoading}
                    className="flex-1 px-4 py-2 rounded-xl text-sm font-semibold text-white transition disabled:opacity-60"
                    style={{ background: 'linear-gradient(135deg,#0d9f9f,#076666)' }}>
                    {inviteLoading ? 'Sending…' : 'Send Credentials'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="text-center mb-4">
                  <div className="text-4xl mb-2">✅</div>
                  <h2 className="text-lg font-bold text-gray-900">Credentials Sent!</h2>
                  <p className="text-sm text-gray-500 mt-1">Share with tenant if SMS/email doesn't arrive:</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-2 font-mono text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Email</span>
                    <span className="font-semibold text-gray-900 truncate ml-4">{inviteResult.email}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Password</span>
                    <span className="font-bold text-teal-600 tracking-widest">{inviteResult.password}</span>
                  </div>
                </div>
                <p className="text-xs text-gray-400 text-center mb-4">Tenant should change their password after first login.</p>
                <button onClick={() => { setInviting(null); setInviteResult(null); }}
                  className="w-full px-4 py-2 rounded-xl text-sm font-semibold text-white"
                  style={{ background: 'linear-gradient(135deg,#0d9f9f,#076666)' }}>
                  Done
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {archiving && <ArchiveModal t={archiving} onClose={() => setArchiving(null)} onDone={refresh} />}
    </div>
  );
}