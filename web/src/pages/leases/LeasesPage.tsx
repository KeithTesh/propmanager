// web/src/pages/leases/LeasesPage.tsx

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, getApiErrorMessage } from '../../lib/api';
import { useToast } from '../../components/ui/Toast';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Lease {
  id: string;
  status: 'draft' | 'active' | 'notice' | 'terminated' | 'expired';
  tenant_name: string; tenant_phone: string;
  unit_number: string; property_name: string; property_id: string;
  monthly_rent: string; deposit_amount: string;
  start_date: string; end_date: string | null;
  outstanding_balance: string; days_remaining: number | null;
  snap_account_reference: string;
  deposit_paid_amount: string;
  deposit_paid_at: string | null;
  created_at: string;
}

interface Tenant   { id: string; full_name: string; phone: string; active_leases: string; }
interface Unit     { id: string; unit_number: string; property_name: string; is_occupied: boolean; monthly_rent: string | null; }
interface Proration {
  isProrated: boolean; billAmount: number; description: string;
  proratedDays: number | null; daysInMonth: number | null;
}

const inputCls = "w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition placeholder-gray-400";

const KES = (n: string | number) =>
  'KES ' + Number(n).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const STATUS_STYLES: Record<string, string> = {
  active:     'bg-emerald-50 text-emerald-700',
  notice:     'bg-amber-50 text-amber-700',
  terminated: 'bg-red-50 text-red-600',
  expired:    'bg-gray-100 text-gray-500',
  draft:      'bg-blue-50 text-blue-600',
};

// ─── Lease Card ───────────────────────────────────────────────────────────────

function LeaseCard({ lease, onTerminate, onNotice, onDeposit, onRenew }: {
  lease: Lease;
  onTerminate: (l: Lease) => void;
  onNotice:    (l: Lease) => void;
  onDeposit:   (l: Lease) => void;
  onRenew:     (l: Lease) => void;
}) {
  const outstanding = parseFloat(lease.outstanding_balance);
  const isActive    = lease.status === 'active';
  const isNotice    = lease.status === 'notice';

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md hover:border-gray-200 transition-all group overflow-hidden">
      <div className="h-1" style={{
        background: isActive ? 'linear-gradient(90deg,#0d9f9f,#076666)' :
                    isNotice ? 'linear-gradient(90deg,#f59e0b,#d97706)' :
                    '#e5e7eb'
      }} />
      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 truncate">{lease.tenant_name}</p>
            <p className="text-xs text-gray-400 mt-0.5">{lease.tenant_phone}</p>
          </div>
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold shrink-0 ${STATUS_STYLES[lease.status]}`}>
            {lease.status.charAt(0).toUpperCase() + lease.status.slice(1)}
          </span>
        </div>

        {/* Unit */}
        <div className="flex items-center gap-1.5 mb-3">
          <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75" />
          </svg>
          <span className="text-sm font-medium text-gray-700">Unit {lease.unit_number}</span>
          <span className="text-xs text-gray-400">· {lease.property_name}</span>
        </div>

        {/* Rent */}
        <div className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-gray-50 mb-3">
          <div>
            <p className="text-xs text-gray-500">Monthly Rent</p>
            <p className="text-base font-bold text-gray-900">{KES(lease.monthly_rent)}</p>
          </div>
          {outstanding > 0 && (
            <div className="text-right">
              <p className="text-xs text-red-500">Outstanding</p>
              <p className="text-base font-bold text-red-600">{KES(outstanding)}</p>
            </div>
          )}
        </div>

        {/* Deposit status */}
        {parseFloat(lease.deposit_amount) > 0 && (
          <div className="flex items-center justify-between text-xs mb-3">
            <span className="text-gray-500">Deposit</span>
            {parseFloat(lease.deposit_paid_amount) >= parseFloat(lease.deposit_amount) ? (
              <span className="text-emerald-600 font-medium flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                {KES(lease.deposit_amount)} collected
              </span>
            ) : parseFloat(lease.deposit_paid_amount) > 0 ? (
              <span className="text-amber-600 font-medium">
                {KES(lease.deposit_paid_amount)} / {KES(lease.deposit_amount)}
              </span>
            ) : (
              <button onClick={() => onDeposit(lease)}
                className="text-teal-600 font-medium hover:text-teal-800 transition underline underline-offset-2">
                {KES(lease.deposit_amount)} pending →
              </button>
            )}
          </div>
        )}

        {/* Dates */}
        <div className="flex items-center justify-between text-xs text-gray-400 mb-4">
          <span>From {new Date(lease.start_date).toLocaleDateString('en-KE', { day:'numeric', month:'short', year:'numeric' })}</span>
          {lease.end_date
            ? <span>To {new Date(lease.end_date).toLocaleDateString('en-KE', { day:'numeric', month:'short', year:'numeric' })}</span>
            : <span className="text-gray-300">Rolling</span>
          }
        </div>

        {/* Ref */}
        <p className="text-xs text-gray-400 font-mono mb-4">Ref: {lease.snap_account_reference}</p>

        {/* Actions */}
        {(isActive || isNotice) && (
          <div className="flex gap-2 pt-3 border-t border-gray-100 opacity-0 group-hover:opacity-100 transition-opacity">
            {isActive && parseFloat(lease.deposit_paid_amount) < parseFloat(lease.deposit_amount) && parseFloat(lease.deposit_amount) > 0 && (
              <button onClick={() => onDeposit(lease)}
                className="flex-1 py-1.5 rounded-lg text-xs font-medium text-teal-600 bg-teal-50 hover:bg-teal-100 transition">
                Deposit
              </button>
            )}
            {isActive && (
              <button onClick={() => onNotice(lease)}
                className="flex-1 py-1.5 rounded-lg text-xs font-medium text-amber-600 bg-amber-50 hover:bg-amber-100 transition">
                Notice
              </button>
            )}
            {['active','notice','expired'].includes(lease.status) && (
              <button onClick={() => onRenew(lease)}
                className="flex-1 py-1.5 rounded-lg text-xs font-medium text-teal-600 bg-teal-50 hover:bg-teal-100 transition">
                🔄 Renew
              </button>
            )}
            <button onClick={() => onTerminate(lease)}
              className="flex-1 py-1.5 rounded-lg text-xs font-medium text-red-500 bg-red-50 hover:bg-red-100 transition">
              Terminate
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Create Lease Modal ───────────────────────────────────────────────────────

function CreateLeaseModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [step, setStep]         = useState<1 | 2 | 3>(1);
  const [tenantSearch, setTenantSearch] = useState('');
  const [unitSearch,   setUnitSearch]   = useState('');

  const [form, setForm] = useState({
    primaryTenantId: '', tenantName: '',
    unitId: '', unitLabel: '',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: '',
    monthlyRent: '',
    depositAmount: '',
    noticePeriodDays: '30',
    isEmployeeBenefit: false,
  });
  const [proration, setProration] = useState<Proration | null>(null);
  const [dueDay,    setDueDay]    = useState(1);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');

  const set = (k: string, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));

  const { data: tenants } = useQuery({
    queryKey: ['tenants-search', tenantSearch],
    queryFn: async () => {
      const p = tenantSearch ? `?search=${encodeURIComponent(tenantSearch)}` : '';
      const res = await apiClient.get<{ data: { tenants: Tenant[] } }>(`/tenants${p}`);
      return res.data.data.tenants;
    },
  });

  const { data: units } = useQuery({
    queryKey: ['units-vacant'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { units: Unit[] } }>('/units?status=vacant');
      return res.data.data.units;
    },
  });

  const filteredUnits = (units ?? []).filter(u =>
    !unitSearch || u.unit_number.toLowerCase().includes(unitSearch.toLowerCase()) ||
    u.property_name.toLowerCase().includes(unitSearch.toLowerCase())
  );

  async function fetchProration() {
    if (!form.monthlyRent || !form.startDate) return;
    try {
      const res = await apiClient.post<{ data: { proration: Proration; dueDay: number } }>(
        '/leases/preview-proration',
        { monthlyRent: parseFloat(form.monthlyRent), startDate: form.startDate }
      );
      setProration(res.data.data.proration);
      setDueDay(res.data.data.dueDay);
    } catch { /* silent */ }
  }

  async function submit() {
    setError(''); setLoading(true);
    try {
      await apiClient.post('/leases', {
        unitId:           form.unitId,
        primaryTenantId:  form.primaryTenantId,
        startDate:        form.startDate,
        endDate:          form.endDate || null,
        monthlyRent:      parseFloat(form.monthlyRent),
        depositAmount:    parseFloat(form.depositAmount || '0'),
        noticePeriodDays: parseInt(form.noticePeriodDays || '30'),
        isEmployeeBenefit:form.isEmployeeBenefit,
      });
      onSaved();
    } catch (e) { setError(getApiErrorMessage(e)); }
    finally { setLoading(false); }
  }

  const canNext1 = form.primaryTenantId && form.unitId;
  const canNext2 = form.monthlyRent && form.startDate;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">New Lease</h2>
            <p className="text-xs text-gray-400 mt-0.5">Step {step} of 3</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex px-6 pt-4 gap-2">
          {[1,2,3].map(s => (
            <div key={s} className="flex-1 h-1.5 rounded-full transition-all"
              style={{ background: s <= step ? '#0d9f9f' : '#e5e7eb' }} />
          ))}
        </div>

        <div className="p-6 space-y-4 max-h-[28rem] overflow-y-auto">
          {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}

          {/* ── Step 1: Tenant + Unit ── */}
          {step === 1 && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Tenant *</label>
                {form.primaryTenantId ? (
                  <div className="flex items-center justify-between p-3 rounded-xl border-2 border-teal-500 bg-teal-50">
                    <div>
                      <p className="text-sm font-semibold text-teal-800">{form.tenantName}</p>
                    </div>
                    <button onClick={() => set('primaryTenantId', '')}
                      className="text-xs text-teal-600 hover:text-teal-800 font-medium">Change</button>
                  </div>
                ) : (
                  <>
                    <input value={tenantSearch} onChange={e => setTenantSearch(e.target.value)}
                      placeholder="Search tenants…" className={inputCls + ' mb-2'} />
                    <div className="border border-gray-200 rounded-xl overflow-hidden max-h-40 overflow-y-auto">
                      {(tenants ?? []).length === 0
                        ? <p className="text-xs text-gray-400 p-3 text-center">No tenants found</p>
                        : (tenants ?? []).map(t => (
                          <button key={t.id} onClick={() => { set('primaryTenantId', t.id); set('tenantName', t.full_name); }}
                            className="w-full text-left px-3 py-2.5 hover:bg-teal-50 transition border-b border-gray-100 last:border-0">
                            <p className="text-sm font-medium text-gray-800">{t.full_name}</p>
                            <p className="text-xs text-gray-400">{t.phone}</p>
                          </button>
                        ))}
                    </div>
                  </>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Vacant Unit *</label>
                {form.unitId ? (
                  <div className="flex items-center justify-between p-3 rounded-xl border-2 border-teal-500 bg-teal-50">
                    <p className="text-sm font-semibold text-teal-800">{form.unitLabel}</p>
                    <button onClick={() => { set('unitId', ''); set('unitLabel', ''); }}
                      className="text-xs text-teal-600 hover:text-teal-800 font-medium">Change</button>
                  </div>
                ) : (
                  <>
                    <input value={unitSearch} onChange={e => setUnitSearch(e.target.value)}
                      placeholder="Search units…" className={inputCls + ' mb-2'} />
                    <div className="border border-gray-200 rounded-xl overflow-hidden max-h-40 overflow-y-auto">
                      {filteredUnits.length === 0
                        ? <p className="text-xs text-gray-400 p-3 text-center">No vacant units found</p>
                        : filteredUnits.map(u => (
                          <button key={u.id} onClick={() => {
                            set('unitId', u.id);
                            set('unitLabel', `Unit ${u.unit_number} · ${u.property_name}`);
                            if (u.monthly_rent) set('monthlyRent', u.monthly_rent);
                          }}
                            className="w-full text-left px-3 py-2.5 hover:bg-teal-50 transition border-b border-gray-100 last:border-0">
                            <p className="text-sm font-medium text-gray-800">Unit {u.unit_number}</p>
                            <p className="text-xs text-gray-400">{u.property_name}{u.monthly_rent ? ` · ${KES(u.monthly_rent)}` : ''}</p>
                          </button>
                        ))}
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          {/* ── Step 2: Terms ── */}
          {step === 2 && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Start Date *</label>
                  <input type="date" value={form.startDate}
                    onChange={e => { set('startDate', e.target.value); setProration(null); }}
                    className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">End Date <span className="text-gray-400 font-normal">(optional)</span></label>
                  <input type="date" value={form.endDate} onChange={e => set('endDate', e.target.value)}
                    min={form.startDate} className={inputCls} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Monthly Rent (KES) *</label>
                  <input type="number" value={form.monthlyRent}
                    onChange={e => { set('monthlyRent', e.target.value); setProration(null); }}
                    onBlur={fetchProration}
                    placeholder="25000" className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Deposit (KES)</label>
                  <input type="number" value={form.depositAmount}
                    onChange={e => set('depositAmount', e.target.value)}
                    placeholder="50000" className={inputCls} />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Notice Period (days)</label>
                <input type="number" value={form.noticePeriodDays}
                  onChange={e => set('noticePeriodDays', e.target.value)}
                  placeholder="30" className={inputCls} />
              </div>

              <label className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 cursor-pointer hover:bg-gray-50 transition">
                <input type="checkbox" checked={form.isEmployeeBenefit}
                  onChange={e => set('isEmployeeBenefit', e.target.checked)}
                  className="w-4 h-4 rounded accent-teal-500" />
                <div>
                  <p className="text-sm font-medium text-gray-800">Employee benefit accommodation</p>
                  <p className="text-xs text-gray-400">E.g. caretaker unit — no billing</p>
                </div>
              </label>
            </>
          )}

          {/* ── Step 3: Review ── */}
          {step === 3 && (
            <>
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Lease Summary</p>
                </div>
                <div className="divide-y divide-gray-100">
                  {[
                    ['Tenant',      form.tenantName],
                    ['Unit',        form.unitLabel],
                    ['Start Date',  new Date(form.startDate).toLocaleDateString('en-KE', { day:'numeric', month:'long', year:'numeric' })],
                    ['End Date',    form.endDate ? new Date(form.endDate).toLocaleDateString('en-KE', { day:'numeric', month:'long', year:'numeric' }) : 'Rolling (no end date)'],
                    ['Monthly Rent',KES(form.monthlyRent)],
                    ['Deposit',     form.depositAmount ? KES(form.depositAmount) : 'None'],
                    ['Notice Period',`${form.noticePeriodDays} days`],
                  ].map(([label, val]) => (
                    <div key={label} className="flex items-center justify-between px-4 py-2.5">
                      <span className="text-xs text-gray-500">{label}</span>
                      <span className="text-sm font-medium text-gray-900">{val}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Signing bill preview */}
              {proration && (
                <div className="rounded-xl p-4 border"
                  style={{ background: '#f0fdfa', borderColor: '#99f6e4' }}>
                  <p className="text-xs font-semibold text-teal-700 uppercase tracking-wide mb-2">
                    First Bill (due on signing)
                  </p>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-teal-800">{proration.description}</p>
                    <p className="text-base font-bold text-teal-900">{KES(proration.billAmount)}</p>
                  </div>
                  <p className="text-xs text-teal-600 mt-1">
                    Bills due on day {dueDay} of each month from next month
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50">
          <button onClick={() => step > 1 ? setStep(s => (s - 1) as 1|2|3) : onClose()}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition">
            {step === 1 ? 'Cancel' : '← Back'}
          </button>
          {step < 3 ? (
            <button
              onClick={() => {
                if (step === 1 && !canNext1) { setError('Select a tenant and unit'); return; }
                if (step === 2 && !canNext2) { setError('Start date and monthly rent are required'); return; }
                setError('');
                if (step === 2) fetchProration();
                setStep(s => (s + 1) as 2|3);
              }}
              className="px-5 py-2 rounded-lg text-sm font-semibold text-white transition"
              style={{ background: '#0d9f9f' }}>
              Next →
            </button>
          ) : (
            <button onClick={submit} disabled={loading}
              className="px-5 py-2 rounded-lg text-sm font-semibold text-white transition disabled:opacity-60 flex items-center gap-2"
              style={{ background: '#0d9f9f' }}>
              {loading && <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
              Activate Lease
            </button>
          )}
        </div>
      </div>
    </div>
  );
}



// ─── Renew Modal ──────────────────────────────────────────────────────────────

function RenewModal({ lease, onClose, onDone }: { lease: Lease; onClose: () => void; onDone: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [newEndDate,     setNewEndDate]     = useState(lease.end_date ? new Date(new Date(lease.end_date).setFullYear(new Date(lease.end_date).getFullYear() + 1)).toISOString().slice(0,10) : '');
  const [newRent,        setNewRent]        = useState(lease.monthly_rent);
  const [renewalNotes,   setRenewalNotes]   = useState('');
  const [openEnded,      setOpenEnded]      = useState(!lease.end_date);
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState('');
  const { toast }  = useToast();

  async function save() {
    setLoading(true); setError('');
    try {
      await apiClient.patch(`/leases/${lease.id}/renew`, {
        newEndDate:     openEnded ? null : newEndDate || null,
        newMonthlyRent: Number(newRent) !== Number(lease.monthly_rent) ? Number(newRent) : undefined,
        renewalNotes:   renewalNotes || undefined,
      });
      toast('Lease renewed successfully', 'success');
      onDone();
    } catch (e) { setError(getApiErrorMessage(e)); }
    finally { setLoading(false); }
  }

  const rentChanged = Number(newRent) !== Number(lease.monthly_rent);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-1">🔄 Renew Lease</h2>
        <p className="text-sm text-gray-500 mb-5">{lease.tenant_name} · Unit {lease.unit_number}</p>

        {error && <div className="mb-4 p-3 rounded-xl bg-red-50 text-sm text-red-600">{error}</div>}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Monthly Rent</label>
            <input type="number" value={newRent} onChange={e => setNewRent(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            {rentChanged && (
              <p className="text-xs text-amber-600 mt-1">
                ⚠️ Rent changing from KES {Number(lease.monthly_rent).toLocaleString()} → KES {Number(newRent).toLocaleString()} — open bills will be updated
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <input type="checkbox" id="open-ended" checked={openEnded} onChange={e => setOpenEnded(e.target.checked)}
                className="rounded" />
              <label htmlFor="open-ended" className="text-sm text-gray-700">Open-ended (no end date)</label>
            </div>
            {!openEnded && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New End Date</label>
                <input type="date" value={newEndDate} onChange={e => setNewEndDate(e.target.value)} min={today}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
            <textarea value={renewalNotes} onChange={e => setRenewalNotes(e.target.value)} rows={2}
              placeholder="e.g. Rent review agreed verbally on..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} disabled={loading}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition">
            Cancel
          </button>
          <button onClick={save} disabled={loading}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition disabled:opacity-50"
            style={{ background: '#0d9f9f' }}>
            {loading ? 'Renewing…' : 'Confirm Renewal'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Deposit Modal ────────────────────────────────────────────────────────────

function DepositModal({ lease, onClose, onDone }: { lease: Lease; onClose: () => void; onDone: () => void }) {
  const remaining = parseFloat(lease.deposit_amount) - parseFloat(lease.deposit_paid_amount);
  const [amount,  setAmount]  = useState(String(remaining));
  const [paidAt,  setPaidAt]  = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  async function submit() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setError('Enter a valid amount'); return; }
    setLoading(true); setError('');
    try {
      await apiClient.patch(`/leases/${lease.id}/deposit`, { amountPaid: amt, paidAt });
      onDone();
    } catch (e) { setError(getApiErrorMessage(e)); setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-1">Record Deposit Payment</h3>
        <p className="text-sm text-gray-500 mb-4">
          {lease.tenant_name} · Unit {lease.unit_number}
        </p>

        {/* Progress */}
        <div className="bg-gray-50 rounded-xl p-4 mb-4">
          <div className="flex justify-between text-xs text-gray-500 mb-2">
            <span>Collected</span>
            <span>{KES(lease.deposit_paid_amount)} of {KES(lease.deposit_amount)}</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(100, (parseFloat(lease.deposit_paid_amount) / parseFloat(lease.deposit_amount)) * 100)}%`,
                background: '#0d9f9f'
              }} />
          </div>
          <p className="text-xs text-gray-400 mt-1.5">
            {KES(remaining)} still outstanding
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Amount Received (KES) *</label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
              placeholder={String(remaining)}
              className="w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Date Received</label>
            <input type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition" />
          </div>
        </div>

        {error && <div className="mt-3 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}

        <div className="flex justify-end gap-3 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition">Cancel</button>
          <button onClick={submit} disabled={loading}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition disabled:opacity-60 flex items-center gap-2"
            style={{ background: '#0d9f9f' }}>
            {loading && <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
            Record Payment
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Terminate Modal ──────────────────────────────────────────────────────────

function TerminateModal({ lease, onClose, onDone }: { lease: Lease; onClose: () => void; onDone: () => void }) {
  const [reason, setReason]   = useState('');
  const [moveOut, setMoveOut] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  async function submit() {
    if (!reason.trim()) { setError('Please provide a reason'); return; }
    setLoading(true); setError('');
    try {
      await apiClient.patch(`/leases/${lease.id}/terminate`, { reason, actualMoveOutDate: moveOut || undefined });
      onDone();
    } catch (e) { setError(getApiErrorMessage(e)); setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-1">Terminate Lease</h3>
        <p className="text-sm text-gray-500 mb-4">
          {lease.tenant_name} · Unit {lease.unit_number}
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Reason *</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
              placeholder="e.g. Tenant vacated, lease agreement ended…"
              className={inputCls + ' resize-none'} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Actual Move-Out Date</label>
            <input type="date" value={moveOut} onChange={e => setMoveOut(e.target.value)} className={inputCls} />
          </div>
        </div>
        {error && <div className="mt-3 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
        <div className="flex justify-end gap-3 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition">Cancel</button>
          <button onClick={submit} disabled={loading}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition disabled:opacity-60 flex items-center gap-2">
            {loading && <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
            Terminate
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Notice Modal ─────────────────────────────────────────────────────────────

function NoticeModal({ lease, onClose, onDone }: { lease: Lease; onClose: () => void; onDone: () => void }) {
  const [noticeDate, setNoticeDate] = useState(new Date().toISOString().slice(0, 10));
  const [moveOutDate, setMoveOutDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  async function submit() {
    if (!moveOutDate) { setError('Stated move-out date is required'); return; }
    setLoading(true); setError('');
    try {
      await apiClient.patch(`/leases/${lease.id}/notice`, {
        vacateNoticeDate: noticeDate, statedMoveOutDate: moveOutDate,
      });
      onDone();
    } catch (e) { setError(getApiErrorMessage(e)); setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-1">Serve Vacate Notice</h3>
        <p className="text-sm text-gray-500 mb-4">{lease.tenant_name} · Unit {lease.unit_number}</p>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Notice Date</label>
            <input type="date" value={noticeDate} onChange={e => setNoticeDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Stated Move-Out Date *</label>
            <input type="date" value={moveOutDate} onChange={e => setMoveOutDate(e.target.value)}
              min={noticeDate} className={inputCls} />
          </div>
        </div>
        {error && <div className="mt-3 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
        <div className="flex justify-end gap-3 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition">Cancel</button>
          <button onClick={submit} disabled={loading}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition disabled:opacity-60"
            style={{ background: '#f59e0b' }}>
            Record Notice
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LeasesPage() {
  const qc = useQueryClient();
  const [showCreate,  setShowCreate]  = useState(false);
  const [terminating, setTerminating] = useState<Lease | null>(null);
  const [depositing,   setDepositing]   = useState<Lease | null>(null);
  const [noticing,    setNoticing]    = useState<Lease | null>(null);
  const [renewing,    setRenewing]    = useState<Lease | null>(null);
  const [filter,      setFilter]      = useState<'all' | 'active' | 'notice' | 'terminated'>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['leases'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { leases: Lease[] } }>('/leases');
      return res.data.data.leases;
    },
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ['leases'] });
    qc.invalidateQueries({ queryKey: ['units-vacant'] });
    qc.invalidateQueries({ queryKey: ['properties'] });
    setShowCreate(false); setTerminating(null); setNoticing(null); setRenewing(null);
  }

  const leases = (data ?? []).filter(l =>
    filter === 'all' ? true : l.status === filter
  );

  const counts = {
    active:     (data ?? []).filter(l => l.status === 'active').length,
    notice:     (data ?? []).filter(l => l.status === 'notice').length,
    terminated: (data ?? []).filter(l => l.status === 'terminated').length,
  };

  return (
    <div className="p-6 lg:p-8 ">

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leases</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {data ? `${counts.active} active · ${counts.notice} on notice` : 'Loading…'}
          </p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm hover:shadow-md transition"
          style={{ background: 'linear-gradient(135deg,#0d9f9f,#076666)' }}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Lease
        </button>
      </div>

      {/* Filter tabs */}
      {data && data.length > 0 && (
        <div className="flex gap-2 mb-6">
          {([
            { k: 'all',        label: `All (${data.length})` },
            { k: 'active',     label: `Active (${counts.active})` },
            { k: 'notice',     label: `On Notice (${counts.notice})` },
            { k: 'terminated', label: `Terminated (${counts.terminated})` },
          ] as const).map(f => (
            <button key={f.k} onClick={() => setFilter(f.k)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition whitespace-nowrap
                ${filter === f.k ? 'text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'}`}
              style={filter === f.k ? { background: '#0d9f9f' } : {}}>
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: '#0d9f9f', borderTopColor: 'transparent' }} />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && data && data.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'linear-gradient(135deg,#e6fafa,#b2eded)' }}>
            <svg className="w-8 h-8" style={{ color: '#0d9f9f' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-gray-900 mb-1">No leases yet</h3>
          <p className="text-sm text-gray-500 mb-5">Create a lease to link a tenant to a unit</p>
          <button onClick={() => setShowCreate(true)}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ background: '#0d9f9f' }}>
            Create First Lease
          </button>
        </div>
      )}

      {/* Grid */}
      {!isLoading && leases.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {leases.map(l => (
            <LeaseCard key={l.id} lease={l}
              onTerminate={setTerminating}
              onNotice={setNoticing}
              onDeposit={setDepositing}
              onRenew={setRenewing} />
          ))}
        </div>
      )}

      {/* No results */}
      {!isLoading && data && data.length > 0 && leases.length === 0 && (
        <div className="text-center py-12">
          <p className="text-sm text-gray-500">No leases with status "{filter}"</p>
        </div>
      )}

      {/* Modals */}
      {showCreate    && <CreateLeaseModal onClose={() => setShowCreate(false)} onSaved={refresh} />}
      {depositing    && <DepositModal lease={depositing} onClose={() => setDepositing(null)} onDone={refresh} />}
      {renewing      && <RenewModal    lease={renewing}    onClose={() => setRenewing(null)}    onDone={refresh} />}
      {terminating   && <TerminateModal lease={terminating} onClose={() => setTerminating(null)} onDone={refresh} />}
      {noticing      && <NoticeModal    lease={noticing}    onClose={() => setNoticing(null)}    onDone={refresh} />}
    </div>
  );
}