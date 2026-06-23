// web/src/pages/remittances/RemittancesPage.tsx

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { apiClient, getApiErrorMessage } from '../../lib/api';
import { toast } from '../../components/ui/toaster';

const C = 'bg-white rounded-2xl border border-gray-100 shadow-sm';
const inputCls = "w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition placeholder-gray-400";

interface Statement {
  id: string; landlord_id: string; landlord_name: string;
  period_month: string; status: 'draft' | 'sent' | 'paid';
  gross_collected: number; commission_amount: number;
  expenses_deducted: number; net_payable: number;
  dispute_flag: boolean; sent_at: string | null; paid_at: string | null;
}

interface Landlord { id: string; full_name: string; }

const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-gray-100',   text: 'text-gray-600',  label: 'Draft' },
  sent:  { bg: 'bg-blue-50',   text: 'text-blue-700',  label: 'Sent'  },
  paid:  { bg: 'bg-green-50',  text: 'text-green-700', label: 'Paid'  },
};

// ─── Generate Statement Modal ─────────────────────────────────────────────────

function GenerateModal({ landlords, preselectedLandlordId, onClose, onCreated }: {
  landlords: Landlord[]; preselectedLandlordId?: string;
  onClose: () => void; onCreated: (id: string) => void;
}) {
  const now     = new Date();
  const defMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);

  const [landlordId, setLandlordId] = useState(preselectedLandlordId ?? '');
  const [month,      setMonth]      = useState(defMonth);
  const [preview,    setPreview]    = useState<any>(null);
  const [loading,    setLoading]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');

  async function generatePreview() {
    if (!landlordId) { setError('Select a landlord first'); return; }
    setLoading(true); setError(''); setPreview(null);
    try {
      const res: any = await apiClient.post('/remittances/generate', {
        landlordId,
        periodMonth: `${month}-01`,
      });
      setPreview(res.data.data.preview);
    } catch(e: any) { setError(getApiErrorMessage(e)); }
    finally { setLoading(false); }
  }

  async function confirm() {
    if (!preview) return;
    setSaving(true); setError('');
    try {
      const res: any = await apiClient.post('/remittances/generate/confirm', preview);
      toast({ title: 'Statement created as draft', variant: 'success' });
      onCreated(res.data.data.statementId);
    } catch(e: any) { setError(getApiErrorMessage(e)); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">Generate Remittance Statement</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Landlord Client</label>
              <select value={landlordId} onChange={e => { setLandlordId(e.target.value); setPreview(null); }}
                className={inputCls + ' bg-white'} disabled={!!preselectedLandlordId}>
                <option value="">Select landlord…</option>
                {landlords.map(l => <option key={l.id} value={l.id}>{l.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Period (Month)</label>
              <input type="month" value={month} onChange={e => { setMonth(e.target.value); setPreview(null); }}
                className={inputCls} />
            </div>
          </div>

          {!preview && (
            <button onClick={generatePreview} disabled={loading || !landlordId}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition"
              style={{ background: 'linear-gradient(135deg,#0d9f9f,#076666)' }}>
              {loading ? 'Calculating…' : 'Calculate Preview →'}
            </button>
          )}

          {preview && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-teal-50 border border-teal-200">
                <p className="text-sm font-bold text-teal-900 mb-3">
                  {preview.landlordName} — {new Date(preview.periodMonth).toLocaleString('en-KE', { month: 'long', year: 'numeric' })}
                </p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      <th className="pb-2">Property</th>
                      <th className="pb-2 text-right">Collected</th>
                      <th className="pb-2 text-right">Commission</th>
                      <th className="pb-2 text-right">Expenses</th>
                      <th className="pb-2 text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-teal-200">
                    {preview.lines.map((l: any) => (
                      <tr key={l.propertyId}>
                        <td className="py-2 text-gray-800 font-medium">{l.propertyName}</td>
                        <td className="py-2 text-right text-gray-700">KES {Number(l.amountCollected).toLocaleString()}</td>
                        <td className="py-2 text-right text-gray-700">KES {Number(l.commissionAmount).toLocaleString()}</td>
                        <td className="py-2 text-right text-gray-700">KES {Number(l.expensesAmount).toLocaleString()}</td>
                        <td className="py-2 text-right font-bold text-teal-800">KES {Number(l.netAmount).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-3 pt-3 border-t border-teal-300 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                  <div><p className="text-xs text-teal-700">Gross Collected</p><p className="font-bold text-teal-900">KES {Number(preview.grossCollected).toLocaleString()}</p></div>
                  <div><p className="text-xs text-teal-700">Commission</p><p className="font-bold text-teal-900">- KES {Number(preview.commissionAmount).toLocaleString()}</p></div>
                  <div><p className="text-xs text-teal-700">Expenses</p><p className="font-bold text-teal-900">- KES {Number(preview.expensesDeducted).toLocaleString()}</p></div>
                  <div><p className="text-xs text-teal-700">Net Payable</p><p className="text-lg font-bold text-teal-900">KES {Number(preview.netPayable).toLocaleString()}</p></div>
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setPreview(null)}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700">
                  Recalculate
                </button>
                <button onClick={confirm} disabled={saving}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg,#0d9f9f,#076666)' }}>
                  {saving ? 'Saving…' : '✅ Save as Draft'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Send Modal (with notes) ──────────────────────────────────────────────────

function SendModal({ statement, onClose, onSent }: {
  statement: Statement; onClose: () => void; onSent: () => void;
}) {
  const [notes,   setNotes]   = useState('');
  const [visible, setVisible] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  async function send() {
    setLoading(true); setError('');
    try {
      await apiClient.patch(`/remittances/${statement.id}/send`, {
        notes: notes || null,
        notesVisibleToLandlord: visible,
      });
      toast({ title: 'Statement sent to landlord', variant: 'success' });
      onSent();
    } catch(e: any) { setError(getApiErrorMessage(e)); }
    finally { setLoading(false); }
  }

  const month = new Date(statement.period_month).toLocaleString('en-KE', { month: 'long', year: 'numeric' });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6">
        <h3 className="font-bold text-gray-900 mb-1">Send Statement to Landlord</h3>
        <p className="text-sm text-gray-500 mb-5">{statement.landlord_name} — {month}</p>
        {error && <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
        {!notes.trim() && (
          <div className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800">
            ⚠️ You haven't added notes yet. Notes help your landlord understand the statement.
          </div>
        )}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Notes for this statement
            </label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4}
              placeholder="e.g. Unit 3B was vacant for 2 weeks. Plumbing repair KES 4,500 deducted — emergency callout. Late payment from Unit 2A included."
              className={inputCls + ' resize-none'} />
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={visible} onChange={e => setVisible(e.target.checked)}
              className="w-4 h-4 rounded accent-teal-600" />
            <span className="text-sm text-gray-700">Show notes to landlord in their portal</span>
          </label>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700">Cancel</button>
          <button onClick={send} disabled={loading}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg,#0d9f9f,#076666)' }}>
            {loading ? 'Sending…' : 'Send to Landlord'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Pay Modal ────────────────────────────────────────────────────────────────

function PayModal({ statement, onClose, onPaid }: {
  statement: Statement; onClose: () => void; onPaid: () => void;
}) {
  const [ref,     setRef]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const month = new Date(statement.period_month).toLocaleString('en-KE', { month: 'long', year: 'numeric' });

  async function markPaid() {
    if (!ref.trim()) { setError('Payment reference is required'); return; }
    setLoading(true); setError('');
    try {
      await apiClient.patch(`/remittances/${statement.id}/paid`, { paymentReference: ref });
      toast({ title: 'Statement marked as paid', variant: 'success' });
      onPaid();
    } catch(e: any) { setError(getApiErrorMessage(e)); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6">
        <h3 className="font-bold text-gray-900 mb-1">Mark as Paid</h3>
        <p className="text-sm text-gray-500 mb-1">{statement.landlord_name} — {month}</p>
        <p className="text-lg font-bold text-teal-700 mb-5">KES {Number(statement.net_payable).toLocaleString()}</p>
        {error && <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Payment Reference *</label>
          <input value={ref} onChange={e => setRef(e.target.value)}
            placeholder="e.g. MPesa ref or bank TXN ID"
            className={inputCls} />
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700">Cancel</button>
          <button onClick={markPaid} disabled={loading}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg,#059669,#047857)' }}>
            {loading ? 'Saving…' : '✅ Mark Paid'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Dispute Panel ────────────────────────────────────────────────────────────

function DisputePanel({ statementId, onResolved }: { statementId: string; onResolved: () => void }) {
  const [response, setResponse] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  const { data } = useQuery({
    queryKey: ['dispute', statementId],
    queryFn: () => apiClient.get(`/remittances/${statementId}`).then((r: any) => r.data.data.dispute),
  });

  async function respond(resolving: boolean) {
    if (!response.trim()) { setError('Please write a response first'); return; }
    setLoading(true); setError('');
    try {
      await apiClient.patch(`/remittances/${statementId}/dispute`, {
        agentResponse: response,
        status: resolving ? 'resolved' : 'agent_responded',
      });
      toast({ title: resolving ? 'Dispute resolved' : 'Response sent', variant: 'success' });
      onResolved();
    } catch(e: any) { setError(getApiErrorMessage(e)); }
    finally { setLoading(false); }
  }

  if (!data) return null;

  return (
    <div className="p-4 rounded-xl bg-red-50 border border-red-200 space-y-3">
      <p className="text-sm font-bold text-red-800">⚠️ Dispute Raised</p>
      <div>
        <p className="text-xs font-semibold text-red-700 mb-1">Landlord's concern:</p>
        <p className="text-sm text-red-900 bg-white p-3 rounded-lg border border-red-200">{data.reason}</p>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <textarea value={response} onChange={e => setResponse(e.target.value)} rows={3}
        placeholder="Explain or resolve the landlord's concern…"
        className="w-full px-3 py-2 rounded-lg border border-red-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-400" />
      <div className="flex gap-3">
        <button onClick={() => respond(false)} disabled={loading}
          className="flex-1 py-2 rounded-lg text-xs font-semibold text-red-700 bg-white border border-red-200 hover:bg-red-50 transition">
          {loading ? '…' : 'Send Response'}
        </button>
        <button onClick={() => respond(true)} disabled={loading}
          className="flex-1 py-2 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-700 transition">
          {loading ? '…' : 'Mark Resolved'}
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function RemittancesPage() {
  const qc              = useQueryClient();
  const [searchParams]  = useSearchParams();
  const [filterLandlord, setFilterLandlord] = useState(searchParams.get('landlordId') ?? '');
  const [filterStatus,   setFilterStatus]   = useState('');
  const [showGenerate,   setShowGenerate]   = useState(false);
  const [sending,        setSending]        = useState<Statement | null>(null);
  const [paying,         setPaying]         = useState<Statement | null>(null);
  const [expanded,       setExpanded]       = useState<string | null>(null);

  const { data: landlords } = useQuery({
    queryKey: ['landlords-list'],
    queryFn: () => apiClient.get('/landlords').then((r: any) => r.data.data.landlords as Landlord[]),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['remittances', filterLandlord, filterStatus],
    queryFn: () => apiClient.get('/remittances', {
      params: {
        landlordId: filterLandlord || undefined,
        status:     filterStatus   || undefined,
      },
    }).then((r: any) => r.data.data.statements as Statement[]),
  });

  const statements = data ?? [];
  const disputeCount = statements.filter(s => s.dispute_flag).length;

  function refreshAll() {
    qc.invalidateQueries({ queryKey: ['remittances'] });
    setSending(null); setPaying(null);
  }

  async function downloadPdf(s: Statement) {
    try {
      const res: any = await apiClient.get(`/remittances/${s.id}/pdf`, { responseType: 'blob' });
      const url  = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a    = document.createElement('a');
      const month = new Date(s.period_month).toLocaleString('en-KE', { month: 'long', year: 'numeric' });
      a.href     = url;
      a.download = `remittance-${s.landlord_name}-${month}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch(e: any) { toast({ title: getApiErrorMessage(e), variant: 'error' }); }
  }

  return (
    <div className="p-6 lg:p-8 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Remittances</h1>
          <p className="text-sm text-gray-500 mt-0.5">Generate and manage monthly statements for landlord clients</p>
        </div>
        <button onClick={() => setShowGenerate(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition"
          style={{ background: 'linear-gradient(135deg,#0d9f9f,#076666)' }}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Generate Statement
        </button>
      </div>

      {/* Dispute alert */}
      {disputeCount > 0 && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 flex items-center gap-3">
          <span className="text-xl">⚠️</span>
          <p className="text-sm font-semibold text-red-800">
            {disputeCount} statement{disputeCount > 1 ? 's have' : ' has'} an open dispute. Review and respond below.
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <select value={filterLandlord} onChange={e => setFilterLandlord(e.target.value)}
          className="px-3.5 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 min-w-[200px]">
          <option value="">All Landlords</option>
          {(landlords ?? []).map(l => <option key={l.id} value={l.id}>{l.full_name}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-3.5 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500">
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="paid">Paid</option>
        </select>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : statements.length === 0 ? (
        <div className={`${C} p-12 text-center`}>
          <p className="font-semibold text-gray-700 mb-1">No statements yet</p>
          <p className="text-sm text-gray-400">Generate your first remittance statement above</p>
        </div>
      ) : (
        <div className="space-y-3">
          {statements.map(s => {
            const st    = STATUS_STYLE[s.status] ?? STATUS_STYLE.draft;
            const month = new Date(s.period_month).toLocaleString('en-KE', { month: 'long', year: 'numeric' });
            const isExp = expanded === s.id;

            return (
              <div key={s.id} className={`${C} overflow-hidden`}>
                <div className="p-5 flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-gray-900">{s.landlord_name}</p>
                      <span className="text-sm text-gray-500">—</span>
                      <p className="text-sm text-gray-600">{month}</p>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${st.bg} ${st.text}`}>{st.label}</span>
                      {s.dispute_flag && (
                        <span className="text-xs font-bold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">⚠️ Dispute</span>
                      )}
                    </div>
                    <div className="flex items-center gap-5 mt-2 text-sm">
                      <span className="text-gray-500">Gross: <span className="font-semibold text-gray-800">KES {Number(s.gross_collected).toLocaleString()}</span></span>
                      <span className="text-gray-400">−</span>
                      <span className="text-gray-500">Commission: <span className="font-semibold text-gray-800">KES {Number(s.commission_amount).toLocaleString()}</span></span>
                      <span className="text-gray-400">=</span>
                      <span className="text-teal-700 font-bold">Net: KES {Number(s.net_payable).toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {s.status === 'draft' && (
                      <button onClick={() => setSending(s)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 transition">
                        Send
                      </button>
                    )}
                    {s.status === 'sent' && (
                      <button onClick={() => setPaying(s)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-green-700 bg-green-50 hover:bg-green-100 transition">
                        Mark Paid
                      </button>
                    )}
                    <button onClick={() => downloadPdf(s)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-700 bg-gray-50 hover:bg-gray-100 transition">
                      PDF
                    </button>
                    {s.dispute_flag && (
                      <button onClick={() => setExpanded(isExp ? null : s.id)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 transition">
                        {isExp ? 'Hide' : 'Dispute'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Dispute panel */}
                {isExp && s.dispute_flag && (
                  <div className="px-5 pb-5">
                    <DisputePanel statementId={s.id} onResolved={refreshAll} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      {showGenerate && (
        <GenerateModal
          landlords={landlords ?? []}
          preselectedLandlordId={filterLandlord || undefined}
          onClose={() => setShowGenerate(false)}
          onCreated={() => { setShowGenerate(false); qc.invalidateQueries({ queryKey: ['remittances'] }); }}
        />
      )}
      {sending  && <SendModal statement={sending} onClose={() => setSending(null)} onSent={refreshAll} />}
      {paying   && <PayModal  statement={paying}  onClose={() => setPaying(null)}  onPaid={refreshAll} />}
    </div>
  );
}