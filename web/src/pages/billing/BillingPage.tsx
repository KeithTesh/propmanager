// web/src/pages/billing/BillingPage.tsx

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, getApiErrorMessage } from '../../lib/api';

interface Bill {
  id: string; lease_id: string;
  tenant_name: string; unit_number: string; property_name: string;
  for_month: string; due_date: string; bill_type: string;
  total_amount: string; total_paid: string; total_due: string;
  adjustment_amount: string;
  status: string; is_prorated: boolean; proration_description: string | null;
  snap_account_reference: string;
  line_items: { item_type: string; amount: string; description: string }[];
}

interface PenaltyPreview {
  bill_id: string; tenant_name: string; tenant_phone: string;
  unit_number: string; property_name: string;
  for_month: string; due_date: string; total_due: string; status: string;
  already_penalised: boolean;
}

interface PenaltyPolicy {
  type: string; value: number; graceDays: number;
  penaltyAfterDays: number; eligibleToday: number;
}

const KES = (n: string | number) =>
  'KES ' + Number(n).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const MONTH = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });

const TYPE_LABEL: Record<string, { label: string; color: string }> = {
  rent:    { label: 'Monthly Rent', color: '#0d9f9f' },
  signing: { label: 'Signing Bill', color: '#7c3aed' },
  deposit: { label: 'Deposit',      color: '#f59e0b' },
  penalty: { label: 'Penalty',      color: '#ef4444' },
  adhoc:   { label: 'Ad-hoc',       color: '#6b7280' },
};

const STATUS_STYLE: Record<string, string> = {
  open:    'bg-blue-50 text-blue-600',
  partial: 'bg-amber-50 text-amber-700',
  overdue: 'bg-red-50 text-red-600',
  paid:    'bg-emerald-50 text-emerald-700',
  waived:  'bg-gray-100 text-gray-500',
  draft:   'bg-gray-100 text-gray-500',
};

function Spinner() {
  return <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
  </svg>;
}

export default function BillingPage() {
  const qc = useQueryClient();
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(
    new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 7)
  );
  const [generating,      setGenerating]      = useState(false);
  const [fixing,          setFixing]          = useState(false);
  const [runningPenalty,  setRunningPenalty]  = useState(false);
  const [showPenaltyPanel, setShowPenaltyPanel] = useState(false);
  const [penaltyResult,   setPenaltyResult]   = useState<{ applied: number; policy: string; details: { tenant: string; unit: string; amount: number }[] } | null>(null);
  const [genResult,       setGenResult]       = useState<{ created: number; skipped: number } | null>(null);
  const [error,           setError]           = useState('');
  const [waivedId,        setWaivedId]        = useState<string | null>(null);
  const [waiveReason,     setWaiveReason]     = useState('');

  const forMonth = selectedMonth + '-01';

  const { data: orphaned } = useQuery({
    queryKey: ['orphaned-bills'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { bills: Bill[] } }>('/billing/orphaned');
      return res.data.data.bills;
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ['billing-bills', selectedMonth],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { bills: Bill[] } }>(`/billing/bills?month=${forMonth}`);
      return res.data.data.bills;
    },
  });

  const { data: penaltyPreviewData } = useQuery({
    queryKey: ['penalty-preview'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { eligible: PenaltyPreview[]; policy: PenaltyPolicy | null } }>('/billing/penalty-preview');
      return res.data.data;
    },
    enabled: showPenaltyPanel,
  });

  async function fixBills() {
    setFixing(true);
    try {
      await apiClient.post('/billing/recalculate-all', { month: forMonth });
      qc.invalidateQueries({ queryKey: ['billing-bills'] });
    } catch (e) { alert(getApiErrorMessage(e)); }
    finally { setFixing(false); }
  }

  async function generate() {
    setGenerating(true); setError(''); setGenResult(null);
    try {
      const res = await apiClient.post<{ data: { created: number; skipped: number; forMonth: string } }>(
        '/billing/generate', { month: forMonth }
      );
      setGenResult(res.data.data);
      setSelectedMonth(res.data.data.forMonth.slice(0, 7));
      qc.invalidateQueries({ queryKey: ['billing-bills'] });
    } catch (e) { setError(getApiErrorMessage(e)); }
    finally { setGenerating(false); }
  }

  async function runPenalties() {
    if (!confirm('Apply late payment penalties to all eligible overdue bills now?')) return;
    setRunningPenalty(true); setPenaltyResult(null); setError('');
    try {
      const res = await apiClient.post<{ data: { applied: number; policy: string; message?: string; details: { tenant: string; unit: string; amount: number }[] } }>(
        '/billing/run-penalties', {}
      );
      setPenaltyResult(res.data.data);
      qc.invalidateQueries({ queryKey: ['billing-bills'] });
      qc.invalidateQueries({ queryKey: ['penalty-preview'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
    } catch (e) { setError(getApiErrorMessage(e)); }
    finally { setRunningPenalty(false); }
  }

  async function deleteBill(billId: string) {
    if (!confirm('Delete this bill? This cannot be undone.')) return;
    try {
      await apiClient.delete(`/billing/bills/${billId}`);
      qc.invalidateQueries({ queryKey: ['billing-bills'] });
      qc.invalidateQueries({ queryKey: ['orphaned-bills'] });
    } catch (e) { setError(getApiErrorMessage(e)); }
  }

  async function waive(billId: string) {
    if (!waiveReason.trim()) return;
    try {
      await apiClient.post(`/billing/bills/${billId}/waive`, { reason: waiveReason });
      qc.invalidateQueries({ queryKey: ['billing-bills'] });
      setWaivedId(null); setWaiveReason('');
    } catch (e) { setError(getApiErrorMessage(e)); }
  }

  const bills        = data ?? [];
  const rentBills    = bills.filter(b => b.bill_type !== 'penalty');
  const penaltyBills = bills.filter(b => b.bill_type === 'penalty');
  // All three totals use the same `bills` set so Billed = Paid + Outstanding always holds
  const totalBilled  = bills.reduce((s, b) => s + parseFloat(b.total_amount), 0);
  const totalPaid    = bills.reduce((s, b) => s + parseFloat(b.total_paid), 0);
  const totalDue     = bills.reduce((s, b) => s + Math.max(parseFloat(b.total_due), 0), 0);
  const unpaidCount  = bills.filter(b => ['open','partial','overdue'].includes(b.status) && parseFloat(b.total_due) > 0).length;
  const penaltyTotal = penaltyBills.reduce((s, b) => s + parseFloat(b.total_amount), 0);

  // Map: lease_id → penalty bill (for inline display under rent row)
  const penaltyByLease: Record<string, Bill> = {};
  penaltyBills.forEach(b => { penaltyByLease[b.lease_id] = b; });

  const policy       = penaltyPreviewData?.policy;
  const eligible     = penaltyPreviewData?.eligible ?? [];
  const eligibleNow  = eligible.filter(e => !e.already_penalised);

  return (
    <div className="p-6 lg:p-8 ">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
          <p className="text-sm text-gray-500 mt-0.5">View and manage monthly bills</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="month" value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          <button onClick={fixBills} disabled={fixing}
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-60 transition bg-white">
            {fixing ? <Spinner /> : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>}
            Recalculate
          </button>
          <button onClick={() => { setShowPenaltyPanel(v => !v); setPenaltyResult(null); }}
            className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold border transition
              ${showPenaltyPanel ? 'bg-red-50 border-red-200 text-red-700' : 'border-gray-200 text-gray-600 bg-white hover:bg-red-50 hover:border-red-200 hover:text-red-700'}`}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            Penalties
          </button>
          <button onClick={generate} disabled={generating}
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60 transition"
            style={{ background: 'linear-gradient(135deg,#0d9f9f,#076666)' }}>
            {generating ? <Spinner /> : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3" /></svg>}
            Generate Bills
          </button>
        </div>
      </div>

      {/* ── PENALTY PANEL ── */}
      {showPenaltyPanel && (
        <div className="mb-6 rounded-2xl border border-red-100 bg-red-50 overflow-hidden">
          <div className="px-5 py-4 flex items-center justify-between border-b border-red-100">
            <div>
              <h2 className="text-sm font-bold text-red-800 flex items-center gap-2">
                <span>⚠️</span> Late Payment Penalties
              </h2>
              {policy ? (
                <p className="text-xs text-red-600 mt-0.5">
                  Policy: <strong>{policy.type === 'flat' ? `KES ${policy.value} flat fee` : `${policy.value}% of amount due`}</strong>
                  {' · '}Grace period: <strong>{policy.graceDays} days</strong>
                  {' · '}Applied after: <strong>{policy.penaltyAfterDays} days past due</strong>
                </p>
              ) : (
                <p className="text-xs text-red-500 mt-0.5">No penalty policy set — configure in Settings → Billing & Payments</p>
              )}
            </div>
            <button onClick={runPenalties} disabled={runningPenalty || !policy || eligibleNow.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 transition shrink-0">
              {runningPenalty ? <Spinner /> : '⚡'}
              Run Penalties Now {eligibleNow.length > 0 && `(${eligibleNow.length})`}
            </button>
          </div>

          {/* Result */}
          {penaltyResult && (
            <div className="px-5 py-3 bg-white border-b border-red-100">
              {penaltyResult.applied === 0 ? (
                <p className="text-sm text-gray-500">No penalties applied — no eligible bills found.</p>
              ) : (
                <div>
                  <p className="text-sm font-semibold text-emerald-700 mb-2">
                    ✅ Applied {penaltyResult.applied} penalt{penaltyResult.applied === 1 ? 'y' : 'ies'} · {penaltyResult.policy}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {penaltyResult.details.map((d, i) => (
                      <span key={i} className="text-xs bg-red-50 border border-red-100 rounded-lg px-2 py-1 text-red-700">
                        Unit {d.unit} · {d.tenant} · {KES(d.amount)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Eligible bills preview */}
          {eligible.length === 0 && policy && (
            <div className="px-5 py-4 text-sm text-red-600">No overdue bills found for this company.</div>
          )}
          {eligible.length > 0 && (
            <div className="divide-y divide-red-100">
              {eligible.map(e => (
                <div key={e.bill_id} className={`px-5 py-3 flex items-center gap-4 ${e.already_penalised ? 'opacity-50' : ''}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-red-900">{e.tenant_name}
                      <span className="text-xs text-red-400 ml-2">Unit {e.unit_number} · {e.property_name}</span>
                    </p>
                    <p className="text-xs text-red-600 mt-0.5">
                      Due {new Date(e.due_date).toLocaleDateString('en-KE')} · Outstanding {KES(e.total_due)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {e.already_penalised ? (
                      <span className="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded-full font-medium">Already penalised</span>
                    ) : (
                      <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full font-semibold">
                        {policy?.type === 'flat' ? KES(policy.value) : `${policy?.value}% = ${KES(Math.floor(Number(e.total_due) * (policy?.value ?? 0) / 100))}`}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Orphaned bills banner */}
      {orphaned && orphaned.length > 0 && (
        <div className="mb-5 p-4 rounded-xl bg-amber-50 border border-amber-200">
          <p className="text-sm font-semibold text-amber-800 mb-2">
            ⚠️ {orphaned.length} unpaid rent bill{orphaned.length > 1 ? 's' : ''} found with no payments
          </p>
          <div className="space-y-1.5">
            {orphaned.map(b => (
              <div key={b.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-amber-100">
                <div className="text-sm text-gray-700">
                  <span className="font-medium">{b.tenant_name}</span>
                  <span className="text-gray-400 ml-2">Unit {b.unit_number} · {b.property_name} · {KES(b.total_amount)} · {b.for_month?.slice(0,7)}</span>
                </div>
                <button onClick={() => deleteBill(b.id)}
                  className="text-xs font-semibold text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 transition">
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Signing bill notice */}
      {!isLoading && bills.some(b => ['signing','deposit'].includes(b.bill_type)) && (
        <div className="mb-5 p-3.5 rounded-xl bg-purple-50 border border-purple-200 text-sm text-purple-800 flex items-center gap-2">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>
          This month has a <strong className="mx-1">Signing Bill</strong> — the tenant's first month rent is included. Any unpaid <strong className="mx-1">Deposit</strong> bills will carry forward each month until paid.
        </div>
      )}

      {/* Result / Error banners */}
      {genResult && (
        <div className="mb-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-center gap-3">
          <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <strong>{genResult.created}</strong> bills generated · <strong>{genResult.skipped}</strong> already existed
        </div>
      )}
      {error && <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}

      {/* Summary cards */}
      {bills.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Total Billed',  value: KES(totalBilled),  sub: `${rentBills.length} bills` },
            { label: 'Collected',     value: KES(totalPaid),    sub: `${bills.filter(b => b.status === 'paid').length} fully paid` },
            { label: 'Outstanding',   value: KES(totalDue),     sub: `${unpaidCount} unpaid` },
            { label: 'Penalties',     value: penaltyBills.length > 0 ? KES(penaltyTotal) : '—',
              sub: penaltyBills.length > 0 ? `${penaltyBills.length} penalty bill${penaltyBills.length > 1 ? 's' : ''}` : 'No penalties this month',
              highlight: penaltyBills.length > 0 },
          ].map(s => (
            <div key={s.label} className={`rounded-xl border p-5 shadow-sm ${(s as any).highlight ? 'bg-red-50 border-red-100' : 'bg-white border-gray-100'}`}>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{s.label}</p>
              <p className={`text-2xl font-bold mt-1 ${(s as any).highlight ? 'text-red-600' : 'text-gray-900'}`}>{s.value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* Bills table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor:'#0d9f9f', borderTopColor:'transparent' }} />
        </div>
      ) : bills.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background:'linear-gradient(135deg,#e6fafa,#b2eded)' }}>
            <svg className="w-8 h-8" style={{ color:'#0d9f9f' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-gray-900 mb-1">No bills for {MONTH(forMonth)}</h3>
          <p className="text-sm text-gray-500 mb-3">Use "Generate Bills" to create bills for all active leases.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                {['Tenant','Unit','Type','Amount','Paid','Due','Status',''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rentBills.map(b => {
                const penalty = penaltyByLease[b.lease_id];
                return (
                  <>
                    {/* Main bill row */}
                    <tr key={b.id} className={`hover:bg-gray-50 transition ${penalty ? 'border-b-0' : ''}`}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{b.tenant_name}</p>
                        <p className="text-xs text-gray-400">{b.snap_account_reference}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        <p>Unit {b.unit_number}</p>
                        <p className="text-xs text-gray-400">{b.property_name}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                          style={{ background:(TYPE_LABEL[b.bill_type]?.color??'#6b7280')+'18', color:TYPE_LABEL[b.bill_type]?.color??'#6b7280' }}>
                          {TYPE_LABEL[b.bill_type]?.label ?? b.bill_type}
                        </span>
                        {b.is_prorated && <span className="ml-1 text-xs text-teal-600">(prorated)</span>}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">{KES(b.total_amount)}</td>
                      <td className="px-4 py-3 text-emerald-600">{parseFloat(b.total_paid)>0 ? KES(b.total_paid) : '—'}</td>
                      <td className="px-4 py-3 font-medium" style={{ color: parseFloat(b.total_due)>0?'#ef4444':'#6b7280' }}>
                        {parseFloat(b.total_due)>0 ? KES(b.total_due) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_STYLE[b.status]??''}`}>{b.status}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {['open','partial','overdue'].includes(b.status) && (
                            <button onClick={() => { setWaivedId(b.id); setWaiveReason(''); }}
                              className="text-xs text-gray-400 hover:text-red-500 transition font-medium">Waive</button>
                          )}
                          {b.status === 'open' && parseFloat(b.total_paid) === 0 && (
                            <button onClick={() => deleteBill(b.id)}
                              className="text-xs text-gray-300 hover:text-red-400 transition font-medium">Delete</button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Penalty sub-row — indented, red tinted */}
                    {penalty && (
                      <tr key={`pen-${penalty.id}`} className="bg-red-50 hover:bg-red-100 transition">
                        <td className="px-4 py-2 pl-8">
                          <p className="text-xs text-red-700 font-medium flex items-center gap-1">
                            <span>↳</span> Late penalty
                          </p>
                        </td>
                        <td className="px-4 py-2 text-xs text-red-500">Unit {penalty.unit_number}</td>
                        <td className="px-4 py-2">
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-600">Penalty</span>
                        </td>
                        <td className="px-4 py-2 text-xs font-semibold text-red-700">{KES(penalty.total_amount)}</td>
                        <td className="px-4 py-2 text-xs text-emerald-600">{parseFloat(penalty.total_paid)>0?KES(penalty.total_paid):'—'}</td>
                        <td className="px-4 py-2 text-xs font-medium" style={{ color: parseFloat(penalty.total_due)>0?'#ef4444':'#6b7280' }}>
                          {parseFloat(penalty.total_due)>0?KES(penalty.total_due):'—'}
                        </td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_STYLE[penalty.status]??''}`}>{penalty.status}</span>
                        </td>
                        <td className="px-4 py-2">
                          {['open','partial','overdue'].includes(penalty.status) && (
                            <button onClick={() => { setWaivedId(penalty.id); setWaiveReason(''); }}
                              className="text-xs text-red-400 hover:text-red-600 transition font-medium">Waive</button>
                          )}
                        </td>
                      </tr>
                    )}
                    {/* Expense charge line items — shown under rent bill */}
                    {b.line_items && b.line_items.length > 0 && b.line_items.map((item, i) => (
                      <tr key={`item-${b.id}-${i}`} className="bg-amber-50 hover:bg-amber-100 transition">
                        <td className="px-4 py-2 pl-8" colSpan={2}>
                          <p className="text-xs text-amber-700 font-medium flex items-center gap-1">
                            <span>↳</span> {item.description}
                          </p>
                        </td>
                        <td className="px-4 py-2">
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-600">Charge</span>
                        </td>
                        <td className="px-4 py-2 text-xs font-semibold text-amber-700">{KES(item.amount)}</td>
                        <td colSpan={4} className="px-4 py-2 text-xs text-gray-400">Included in rent bill above</td>
                      </tr>
                    ))}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Waive modal */}
      {waivedId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background:'rgba(0,0,0,0.45)', backdropFilter:'blur(4px)' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Waive Bill</h3>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Reason *</label>
            <textarea value={waiveReason} onChange={e => setWaiveReason(e.target.value)} rows={3}
              placeholder="e.g. Tenant agreement, goodwill gesture…"
              className="w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal-500" />
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setWaivedId(null)} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition">Cancel</button>
              <button onClick={() => waive(waivedId!)} disabled={!waiveReason.trim()}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition disabled:opacity-50">
                Waive Bill
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}