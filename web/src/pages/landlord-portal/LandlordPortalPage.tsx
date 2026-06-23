// web/src/pages/landlord-portal/LandlordPortalPage.tsx
// Shown to users with role='landlord_client' — read-only portal
// No sidebar. Top nav only. All data scoped to their landlord record.

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, getApiErrorMessage } from '../../lib/api';
import { useAuthStore } from '../../stores/authStore';
import { toast } from '../../components/ui/toaster';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const KES   = (n: number | string) => `KES ${Number(n).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
const DATE  = (d: string) => new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
const MONTH = (d: string) => new Date(d).toLocaleString('en-KE', { month: 'long', year: 'numeric' });
const C     = 'bg-white rounded-2xl border border-gray-100 shadow-sm';

type Tab = 'overview' | 'properties' | 'collections' | 'statements';

const STATEMENT_STATUS: Record<string, { bg: string; text: string; label: string }> = {
  sent: { bg: 'bg-blue-50',  text: 'text-blue-700',  label: 'Sent'  },
  paid: { bg: 'bg-green-50', text: 'text-green-700', label: 'Paid'  },
};

// ─── Dispute Modal ────────────────────────────────────────────────────────────

function DisputeModal({ statementId, onClose, onSubmitted }: {
  statementId: string; onClose: () => void; onSubmitted: () => void;
}) {
  const [reason,  setReason]  = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  async function submit() {
    if (reason.trim().length < 10) { setError('Please provide at least 10 characters explaining the issue'); return; }
    setLoading(true); setError('');
    try {
      await apiClient.post(`/landlord-portal/statements/${statementId}/dispute`, { reason });
      toast({ title: 'Dispute raised. Your agent will respond within 2 business days.', variant: 'success' });
      onSubmitted();
    } catch(e: any) { setError(getApiErrorMessage(e)); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6">
        <h3 className="font-bold text-gray-900 mb-1">Flag Statement Issue</h3>
        <p className="text-sm text-gray-500 mb-5">Tell us what looks wrong and your agent will review it.</p>
        {error && <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">What looks wrong?</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={4}
            placeholder="e.g. The maintenance expense of KES 8,000 was not authorised by me. Please clarify which repair this relates to."
            className="w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
          <p className="text-xs text-gray-400 mt-1">{reason.length} characters</p>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={submit} disabled={loading}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: '#ef4444' }}>
            {loading ? 'Submitting…' : '⚠️ Flag Issue'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ agentName }: { agentName: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['lp-overview'],
    queryFn: () => apiClient.get('/landlord-portal/overview').then((r: any) => r.data.data),
  });

  if (isLoading) return <Spinner />;

  const portfolio = data?.portfolio;
  const month     = data?.thisMonth;
  const last      = data?.lastStatement;
  const disputes  = data?.openDisputeCount ?? 0;

  return (
    <div className="space-y-6">
      {/* Managed by */}
      <div className="p-4 rounded-xl bg-teal-50 border border-teal-200 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'linear-gradient(135deg,#0d9f9f,#076666)' }}>
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15" />
          </svg>
        </div>
        <div>
          <p className="text-xs text-teal-700 font-semibold">Managed by</p>
          <p className="text-sm font-bold text-teal-900">{agentName}</p>
        </div>
      </div>

      {/* Open dispute warning */}
      {disputes > 0 && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-center gap-3">
          <span className="text-xl">⚠️</span>
          <p className="text-sm font-semibold text-amber-800">
            You have {disputes} open dispute{disputes > 1 ? 's' : ''} awaiting agent response.
          </p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Properties',    value: portfolio?.property_count ?? 0, color: '#0d9f9f' },
          { label: 'Total Units',   value: portfolio?.unit_count     ?? 0, color: '#7c3aed' },
          { label: 'Occupied',      value: portfolio?.occupied_units  ?? 0, color: '#2563eb' },
          { label: 'Occupancy',     value: `${portfolio?.occupancy_rate ?? 0}%`, color: '#059669' },
        ].map(s => (
          <div key={s.label} className={`${C} p-4`}>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{s.label}</p>
            <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* This month */}
      <div className={`${C} p-5`}>
        <h3 className="text-sm font-bold text-gray-700 mb-4">This Month</h3>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-gray-400 mb-1">Total Billed</p>
            <p className="text-lg font-bold text-gray-900">{KES(month?.total_billed ?? 0)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">Collected</p>
            <p className="text-lg font-bold text-emerald-700">{KES(month?.total_collected ?? 0)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">Outstanding</p>
            <p className="text-lg font-bold text-red-600">
              {KES(Math.max(0, Number(month?.total_billed ?? 0) - Number(month?.total_collected ?? 0)))}
            </p>
          </div>
        </div>
        {Number(month?.total_billed ?? 0) > 0 && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-gray-400 mb-1.5">
              <span>Collection rate</span>
              <span className="font-semibold">
                {Math.round(Number(month?.total_collected ?? 0) / Number(month?.total_billed) * 100)}%
              </span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${Math.min(100, Math.round(Number(month?.total_collected ?? 0) / Number(month?.total_billed) * 100))}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Last remittance */}
      {last && (
        <div className={`${C} p-5`}>
          <h3 className="text-sm font-bold text-gray-700 mb-3">Last Remittance</h3>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold text-gray-900">{MONTH(last.period_month)}</p>
              <p className="text-sm text-gray-500 mt-0.5">
                {last.status === 'paid'
                  ? `Paid ${last.paid_at ? DATE(last.paid_at) : ''}`
                  : 'Awaiting payment'}
              </p>
              {last.dispute_flag && (
                <p className="text-xs text-red-600 font-semibold mt-1">⚠️ Dispute raised</p>
              )}
            </div>
            <div className="text-right">
              <p className="text-xl font-bold text-teal-700">{KES(last.net_payable)}</p>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                last.status === 'paid' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'
              }`}>{last.status === 'paid' ? 'Paid' : 'Sent'}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Properties Tab ───────────────────────────────────────────────────────────

function PropertiesTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['lp-properties'],
    queryFn: () => apiClient.get('/landlord-portal/properties').then((r: any) => r.data.data.properties),
  });

  if (isLoading) return <Spinner />;
  const properties = data ?? [];

  return (
    <div className="space-y-4">
      {properties.length === 0 ? (
        <div className={`${C} p-10 text-center text-gray-400 text-sm`}>No properties assigned yet</div>
      ) : properties.map((p: any) => (
        <div key={p.id} className={`${C} p-5`}>
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-bold text-gray-900">{p.name}</h3>
              {p.address && <p className="text-sm text-gray-500 mt-0.5">{p.address}{p.county ? `, ${p.county}` : ''}</p>}
            </div>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
              Number(p.occupancy_rate) >= 80
                ? 'bg-green-50 text-green-700'
                : Number(p.occupancy_rate) >= 50
                  ? 'bg-amber-50 text-amber-700'
                  : 'bg-red-50 text-red-700'
            }`}>
              {p.occupancy_rate ?? 0}% occupied
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-gray-100">
            {[
              { label: 'Total Units',   value: p.unit_count    },
              { label: 'Occupied',      value: p.occupied_units },
              { label: 'Vacant',        value: p.vacant_units  },
            ].map(s => (
              <div key={s.label} className="text-center">
                <p className="text-lg font-bold text-gray-900">{s.value}</p>
                <p className="text-xs text-gray-400">{s.label}</p>
              </div>
            ))}
          </div>
          <div className="mt-3">
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-teal-500 transition-all"
                style={{ width: `${p.occupancy_rate ?? 0}%` }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Collections Tab ──────────────────────────────────────────────────────────

function CollectionsTab() {
  const now      = new Date();
  const defMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [month, setMonth] = useState(defMonth);

  const { data, isLoading } = useQuery({
    queryKey: ['lp-collections', month],
    queryFn: () => apiClient.get('/landlord-portal/collections', {
      params: { month: `${month}-01` },
    }).then((r: any) => r.data.data),
  });

  const collections = data?.collections ?? [];
  const totals      = data?.totals ?? {};

  return (
    <div className="space-y-5">
      {/* Month selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-semibold text-gray-700">Month</label>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)}
          className="px-3.5 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500" />
      </div>

      {isLoading ? <Spinner /> : (
        <>
          {/* Totals row */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Total Billed',    value: totals.totalBilled    ?? 0, color: '#374151' },
              { label: 'Total Collected', value: totals.totalCollected ?? 0, color: '#059669' },
              { label: 'Outstanding',     value: totals.outstanding    ?? 0, color: '#dc2626' },
            ].map(s => (
              <div key={s.label} className={`${C} p-4 text-center`}>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{s.label}</p>
                <p className="text-lg font-bold" style={{ color: s.color }}>{KES(s.value)}</p>
              </div>
            ))}
          </div>

          {/* Per property table */}
          {collections.length === 0 ? (
            <div className={`${C} p-10 text-center text-gray-400 text-sm`}>No billing data for this month</div>
          ) : (
            <div className={`${C} overflow-hidden`}>
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100">
                    <th className="px-5 py-3">Property</th>
                    <th className="px-5 py-3 text-center">Units</th>
                    <th className="px-5 py-3 text-right">Billed</th>
                    <th className="px-5 py-3 text-right">Collected</th>
                    <th className="px-5 py-3 text-right">Outstanding</th>
                    <th className="px-5 py-3 text-center">Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {collections.map((p: any) => (
                    <tr key={p.property_id} className="hover:bg-gray-50 transition">
                      <td className="px-5 py-3.5 font-medium text-sm text-gray-900">{p.property_name}</td>
                      <td className="px-5 py-3.5 text-center text-sm text-gray-500">{p.occupied_units}/{p.unit_count}</td>
                      <td className="px-5 py-3.5 text-right text-sm text-gray-700">{KES(p.total_billed)}</td>
                      <td className="px-5 py-3.5 text-right text-sm font-semibold text-emerald-700">{KES(p.total_collected)}</td>
                      <td className="px-5 py-3.5 text-right text-sm font-semibold text-red-600">{KES(p.outstanding)}</td>
                      <td className="px-5 py-3.5 text-center">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                          Number(p.collection_rate) >= 90 ? 'bg-green-50 text-green-700'
                          : Number(p.collection_rate) >= 70 ? 'bg-amber-50 text-amber-700'
                          : 'bg-red-50 text-red-700'
                        }`}>{p.collection_rate ?? 0}%</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Statements Tab ───────────────────────────────────────────────────────────

function StatementsTab() {
  const qc = useQueryClient();
  const [disputingId, setDisputingId] = useState<string | null>(null);
  const [expanded,    setExpanded]    = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['lp-statements'],
    queryFn: () => apiClient.get('/landlord-portal/statements').then((r: any) => r.data.data.statements),
  });

  async function downloadPdf(s: any) {
    try {
      const res: any = await apiClient.get(`/remittances/${s.id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a   = document.createElement('a');
      a.href    = url;
      a.download = `statement-${MONTH(s.period_month)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch(e: any) { toast({ title: getApiErrorMessage(e), variant: 'error' }); }
  }

  if (isLoading) return <Spinner />;
  const statements = data ?? [];

  return (
    <div className="space-y-3">
      {statements.length === 0 ? (
        <div className={`${C} p-10 text-center text-gray-400 text-sm`}>
          No statements available yet. Your agent will send you statements each month.
        </div>
      ) : statements.map((s: any) => {
        const st  = STATEMENT_STATUS[s.status] ?? STATEMENT_STATUS.sent;
        const isExp = expanded === s.id;

        return (
          <div key={s.id} className={`${C} overflow-hidden`}>
            <div className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-gray-900">{MONTH(s.period_month)}</p>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${st.bg} ${st.text}`}>{st.label}</span>
                    {s.dispute_flag && (
                      <span className="text-xs font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                        ⚠️ Dispute Open
                      </span>
                    )}
                    {s.dispute_status === 'agent_responded' && (
                      <span className="text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                        💬 Agent Responded
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-sm">
                    <div><p className="text-xs text-gray-400">Gross Collected</p><p className="font-semibold text-gray-700">{KES(s.gross_collected)}</p></div>
                    <div><p className="text-xs text-gray-400">Commission</p><p className="font-semibold text-gray-700">- {KES(s.commission_amount)}</p></div>
                    <div><p className="text-xs text-gray-400">Expenses</p><p className="font-semibold text-gray-700">- {KES(s.expenses_deducted)}</p></div>
                    <div><p className="text-xs text-gray-400">Net Payable</p><p className="text-base font-bold text-teal-700">{KES(s.net_payable)}</p></div>
                  </div>
                  {s.paid_at && (
                    <p className="text-xs text-gray-400 mt-2">Paid on {DATE(s.paid_at)}</p>
                  )}
                </div>

                <div className="flex flex-col gap-2 shrink-0">
                  <button onClick={() => setExpanded(isExp ? null : s.id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 transition">
                    {isExp ? 'Hide' : 'Details'}
                  </button>
                  <button onClick={() => downloadPdf(s)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-700 bg-gray-50 hover:bg-gray-100 transition">
                    PDF
                  </button>
                  {!s.dispute_flag && (
                    <button onClick={() => setDisputingId(s.id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 transition">
                      Flag Issue
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Expanded detail */}
            {isExp && (
              <div className="border-t border-gray-100 p-5 space-y-4 bg-gray-50">

                {/* Agent notes */}
                {s.notes && (
                  <div className="p-4 rounded-xl bg-white border border-gray-200">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Agent Notes</p>
                    <p className="text-sm text-gray-700 leading-relaxed">{s.notes}</p>
                  </div>
                )}

                {/* Dispute thread */}
                {s.dispute_flag && (
                  <div className="p-4 rounded-xl bg-red-50 border border-red-200 space-y-3">
                    <p className="text-xs font-semibold text-red-700 uppercase tracking-wide">Your Dispute</p>
                    <p className="text-sm text-red-900">{s.dispute_reason}</p>
                    {s.agent_response && (
                      <div className="mt-2 p-3 rounded-lg bg-white border border-red-200">
                        <p className="text-xs font-semibold text-gray-500 mb-1">Agent Response</p>
                        <p className="text-sm text-gray-800">{s.agent_response}</p>
                      </div>
                    )}
                    {!s.agent_response && (
                      <p className="text-xs text-red-600 italic">Awaiting agent response…</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {disputingId && (
        <DisputeModal
          statementId={disputingId}
          onClose={() => setDisputingId(null)}
          onSubmitted={() => {
            setDisputingId(null);
            qc.invalidateQueries({ queryKey: ['lp-statements'] });
            qc.invalidateQueries({ queryKey: ['lp-overview'] });
          }}
        />
      )}
    </div>
  );
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <div className="w-7 h-7 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LandlordPortalPage() {
  const { logout } = useAuthStore();
  const [tab, setTab] = useState<Tab>('overview');

  const { data: meData } = useQuery({
    queryKey: ['lp-me'],
    queryFn: () => apiClient.get('/landlord-portal/me').then((r: any) => r.data.data),
  });

  const landlord  = meData?.landlord;
  const agentName = meData?.agent?.name ?? '';

  const TABS: { k: Tab; icon: string; label: string }[] = [
    { k: 'overview',    icon: '📊', label: 'Overview'    },
    { k: 'properties',  icon: '🏢', label: 'Properties'  },
    { k: 'collections', icon: '💰', label: 'Collections' },
    { k: 'statements',  icon: '📄', label: 'Statements'  },
  ];

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Top nav */}
      <nav className="bg-white border-b border-gray-100 sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'linear-gradient(135deg,#0d9f9f,#076666)' }}>
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900 leading-tight">{landlord?.fullName ?? 'Landlord Portal'}</p>
              {agentName && <p className="text-xs text-gray-400 leading-tight">via {agentName}</p>}
            </div>
          </div>
          <button onClick={logout}
            className="text-sm font-medium text-gray-500 hover:text-gray-700 transition flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
            </svg>
            Sign out
          </button>
        </div>

        {/* Tab bar */}
        <div className="max-w-4xl mx-auto px-4 sm:px-6 flex overflow-x-auto">
          {TABS.map(t => (
            <button key={t.k} onClick={() => setTab(t.k)}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition ${
                tab === t.k
                  ? 'border-teal-500 text-teal-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {tab === 'overview'    && <OverviewTab agentName={agentName} />}
        {tab === 'properties'  && <PropertiesTab />}
        {tab === 'collections' && <CollectionsTab />}
        {tab === 'statements'  && <StatementsTab />}
      </main>

      {/* Read-only watermark */}
      <div className="fixed bottom-4 right-4 pointer-events-none">
        <span className="text-xs text-gray-300 font-medium">Read-only view</span>
      </div>
    </div>
  );
}