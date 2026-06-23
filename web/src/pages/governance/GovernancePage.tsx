// web/src/pages/governance/GovernancePage.tsx

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, getApiErrorMessage } from '../../lib/api';
import { useAuthStore } from '../../stores/authStore';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PendingExpense {
  id: string; description: string; category: string; amount: string;
  expense_date: string; property_name?: string; vendor_name?: string;
  submitted_by_name?: string; created_at: string; approval_notes?: string;
}

interface ReversedPayment {
  id: string; amount: string; channel: string; reversed_at: string;
  reversal_reason: string; reversed_by_name?: string;
  for_month?: string; unit_number?: string; property_name?: string;
  mpesa_receipt_number?: string; bank_transaction_ref?: string;
}

interface FinancialPeriod {
  id: string; period_month: string;
  status: 'open' | 'closing' | 'closed' | 'locked';
  force_closed: boolean; force_close_notes?: string;
  closed_at?: string; closed_by_name?: string;
  locked_at?: string; locked_by_name?: string;
}

interface PreCloseCheck {
  period: FinancialPeriod;
  can_close: boolean; blockers: string[]; warnings: string[];
  unmatched_payments: number; open_bills: number; pending_expenses: number;
}

interface GovSettings { expense_approval_threshold: string | null; }

// ─── Utils ────────────────────────────────────────────────────────────────────

const KES = (n: string | number) =>
  'KES ' + Number(n).toLocaleString('en-KE', { maximumFractionDigits: 0 });

const fmtDate = (d?: string) => {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
};

const fmtMonth = (d: string) => {
  if (!d) return '—';
  const clean = typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10);
  const dt = new Date(clean + 'T12:00:00');
  return isNaN(dt.getTime()) ? clean : dt.toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
};

const inputCls  = 'w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500';

const PERIOD_BADGE: Record<string, string> = {
  open:    'bg-green-100 text-green-700',
  closing: 'bg-amber-100 text-amber-700',
  closed:  'bg-blue-100 text-blue-700',
  locked:  'bg-gray-100 text-gray-600',
};

const PERIOD_ICON: Record<string, string> = {
  open: '🟢', closing: '🟡', closed: '🔵', locked: '🔒',
};

// ─── Expense Approval Tab ─────────────────────────────────────────────────────

function ExpenseApprovals({ isOwner: _isOwner }: { isOwner: boolean }) {
  const qc = useQueryClient();
  const [expandId, setExpandId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [approveNotes, setApproveNotes] = useState('');
  const [err, setErr] = useState('');

  const pending = useQuery({
    queryKey: ['pending-expenses'],
    queryFn: () => apiClient.get('/governance/expenses/pending').then(r => r.data.data as PendingExpense[]),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['pending-expenses'] });
    qc.invalidateQueries({ queryKey: ['expenses'] });
  };

  const approve = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes: string }) =>
      apiClient.post(`/governance/expenses/${id}/approve`, { notes }),
    onSuccess: () => { invalidate(); setExpandId(null); setApproveNotes(''); setErr(''); },
    onError: (e: any) => setErr(getApiErrorMessage(e)),
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient.post(`/governance/expenses/${id}/reject`, { reason }),
    onSuccess: () => { invalidate(); setRejectId(null); setRejectReason(''); setErr(''); },
    onError: (e: any) => setErr(getApiErrorMessage(e)),
  });

  if (pending.isLoading) return <div className="py-12 text-center text-gray-400 text-sm">Loading…</div>;

  return (
    <div className="space-y-3">
      {err && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm flex justify-between">
          {err} <button onClick={() => setErr('')} className="text-red-400 hover:text-red-600 ml-2">✕</button>
        </div>
      )}

      {pending.data?.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">✅</div>
          <div className="font-medium">No pending expense approvals</div>
          <div className="text-sm mt-1">All expenses are approved</div>
        </div>
      )}

      {pending.data?.map(exp => (
        <div key={exp.id} className="bg-white rounded-xl border border-amber-200 overflow-hidden">
          <div
            className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-amber-50"
            onClick={() => setExpandId(expandId === exp.id ? null : exp.id)}
          >
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
              <div>
                <div className="font-semibold text-gray-900">{exp.description}</div>
                <div className="text-xs text-gray-500">
                  {exp.category}{exp.property_name ? ` · ${exp.property_name}` : ''}
                  {exp.submitted_by_name ? ` · submitted by ${exp.submitted_by_name}` : ''}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="font-bold text-gray-900">{KES(exp.amount)}</div>
                <div className="text-xs text-gray-400">{fmtDate(exp.expense_date)}</div>
              </div>
              <span className="text-gray-400">{expandId === exp.id ? '▲' : '▼'}</span>
            </div>
          </div>

          {expandId === exp.id && (
            <div className="border-t border-amber-100 px-4 py-4 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <div><span className="text-gray-500">Amount</span><br /><span className="font-semibold text-gray-900">{KES(exp.amount)}</span></div>
                <div><span className="text-gray-500">Date</span><br /><span className="font-medium">{fmtDate(exp.expense_date)}</span></div>
                <div><span className="text-gray-500">Category</span><br /><span className="font-medium capitalize">{exp.category}</span></div>
                {exp.vendor_name && <div><span className="text-gray-500">Vendor</span><br /><span className="font-medium">{exp.vendor_name}</span></div>}
                {exp.property_name && <div><span className="text-gray-500">Property</span><br /><span className="font-medium">{exp.property_name}</span></div>}
                {exp.submitted_by_name && <div><span className="text-gray-500">Submitted by</span><br /><span className="font-medium">{exp.submitted_by_name}</span></div>}
              </div>

              {/* Reject modal inline */}
              {rejectId === exp.id ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3">
                  <div className="font-medium text-red-800 text-sm">Rejection reason (required)</div>
                  <textarea
                    className="w-full px-3 py-2 rounded-lg border border-red-200 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                    rows={2}
                    placeholder="Explain why this expense is rejected…"
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button onClick={() => { setRejectId(null); setRejectReason(''); }}
                      className="px-3 py-2 rounded-lg border border-gray-200 text-sm hover:bg-gray-50">Cancel</button>
                    <button
                      disabled={rejectReason.length < 3 || reject.isPending}
                      onClick={() => reject.mutate({ id: exp.id, reason: rejectReason })}
                      className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-40">
                      Confirm Reject
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">Approval notes (optional)</label>
                  <input
                    className={inputCls}
                    placeholder="Any notes to attach to approval…"
                    value={approveNotes}
                    onChange={e => setApproveNotes(e.target.value)}
                  />
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => approve.mutate({ id: exp.id, notes: approveNotes })}
                      disabled={approve.isPending}
                      className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-40">
                      ✓ Approve
                    </button>
                    <button
                      onClick={() => { setRejectId(exp.id); setApproveNotes(''); }}
                      className="px-4 py-2 rounded-lg border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50">
                      ✕ Reject
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Payment Reversals Tab ────────────────────────────────────────────────────

function PaymentReversals({ isOwner: _isOwner }: { isOwner: boolean }) {
  const qc = useQueryClient();
  const [reverseId, setReverseId] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [paymentRef, setPaymentRef] = useState('');
  const [err, setErr] = useState('');

  const reversed = useQuery({
    queryKey: ['reversed-payments'],
    queryFn: () => apiClient.get('/governance/payments/reversed').then(r => r.data.data as ReversedPayment[]),
  });

  const reverse = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient.post(`/governance/payments/${id}/reverse`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reversed-payments'] });
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['billing'] });
      setReverseId(null); setReverseReason(''); setPaymentRef(''); setErr('');
    },
    onError: (e: any) => setErr(getApiErrorMessage(e)),
  });

  return (
    <div className="space-y-5">
      {err && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm flex justify-between">
          {err} <button onClick={() => setErr('')} className="text-red-400 ml-2">✕</button>
        </div>
      )}

      {/* Reverse a payment */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-900 mb-1">Reverse a Payment</h3>
        <p className="text-xs text-gray-500 mb-4">
          Enter the Payment ID to reverse. This re-opens the bill so the tenant owes again.
          Reversals are permanent and logged to the audit trail.
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Payment ID (UUID)</label>
            <input className={inputCls} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={paymentRef} onChange={e => setPaymentRef(e.target.value)} />
          </div>
          {reverseId === '__new__' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason for reversal (required)</label>
              <textarea
                className="w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                rows={2}
                placeholder="e.g. Incorrect amount, wrong tenant, bank error…"
                value={reverseReason}
                onChange={e => setReverseReason(e.target.value)}
              />
              <div className="flex gap-2 mt-2">
                <button onClick={() => { setReverseId(null); setReverseReason(''); }}
                  className="px-3 py-2 rounded-lg border border-gray-200 text-sm hover:bg-gray-50">Cancel</button>
                <button
                  disabled={reverseReason.length < 5 || reverse.isPending}
                  onClick={() => reverse.mutate({ id: paymentRef.trim(), reason: reverseReason })}
                  className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-40">
                  Confirm Reversal
                </button>
              </div>
            </div>
          )}
          {reverseId !== '__new__' && (
            <button
              disabled={paymentRef.trim().length < 30}
              onClick={() => setReverseId('__new__')}
              className="px-4 py-2.5 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-40">
              Proceed to Reverse
            </button>
          )}
        </div>
      </div>

      {/* Reversal history */}
      <div>
        <h3 className="font-semibold text-gray-700 mb-3 text-sm uppercase tracking-wider">Reversal History</h3>
        {reversed.data?.length === 0 && (
          <div className="text-center py-10 text-gray-400 text-sm">No payment reversals recorded</div>
        )}
        <div className="space-y-2">
          {reversed.data?.map(p => (
            <div key={p.id} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-gray-900">{KES(p.amount)}
                    <span className="ml-2 text-xs text-gray-400 font-normal capitalize">{p.channel.replace('_', ' ')}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {p.property_name}{p.unit_number ? ` · Unit ${p.unit_number}` : ''}
                    {p.for_month ? ` · ${fmtMonth(p.for_month)}` : ''}
                  </div>
                  <div className="text-xs text-red-600 mt-1">Reason: {p.reversal_reason}</div>
                </div>
                <div className="text-right text-xs text-gray-400">
                  <div>{fmtDate(p.reversed_at)}</div>
                  {p.reversed_by_name && <div>by {p.reversed_by_name}</div>}
                </div>
              </div>
              <div className="text-xs text-gray-400 mt-1.5 font-mono">{p.id}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Financial Periods Tab ────────────────────────────────────────────────────

function FinancialPeriods({ isOwner }: { isOwner: boolean }) {
  const qc = useQueryClient();
  const [expandId, setExpandId]       = useState<string | null>(null);
  const [preCheck, setPreCheck]       = useState<PreCloseCheck | null>(null);
  const [forceNotes, setForceNotes]   = useState('');
  const [showForce, setShowForce]     = useState<string | null>(null);
  const [newMonth, setNewMonth]       = useState(new Date().toISOString().slice(0, 7));
  const [err, setErr]                 = useState('');

  const periods = useQuery({
    queryKey: ['financial-periods'],
    queryFn: () => apiClient.get('/governance/periods').then(r => r.data.data as FinancialPeriod[]),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['financial-periods'] });

  const openPeriod = useMutation({
    mutationFn: () => apiClient.post('/governance/periods', { period_month: newMonth }),
    onSuccess: () => { invalidate(); setErr(''); },
    onError: (e: any) => setErr(getApiErrorMessage(e)),
  });

  const runPreCheck = async (id: string) => {
    try {
      const r = await apiClient.get(`/governance/periods/${id}/pre-close-check`);
      setPreCheck(r.data.data);
      setExpandId(id);
    } catch (e: any) { setErr(getApiErrorMessage(e)); }
  };

  const closePeriod = useMutation({
    mutationFn: (id: string) => apiClient.post(`/governance/periods/${id}/close`),
    onSuccess: () => { invalidate(); setPreCheck(null); setErr(''); },
    onError: (e: any) => setErr(getApiErrorMessage(e)),
  });

  const forceClose = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes: string }) =>
      apiClient.post(`/governance/periods/${id}/force-close`, { notes }),
    onSuccess: () => { invalidate(); setShowForce(null); setForceNotes(''); setErr(''); },
    onError: (e: any) => setErr(getApiErrorMessage(e)),
  });

  const lockPeriod = useMutation({
    mutationFn: (id: string) => apiClient.post(`/governance/periods/${id}/lock`),
    onSuccess: () => { invalidate(); setErr(''); },
    onError: (e: any) => setErr(getApiErrorMessage(e)),
  });

  const reopenPeriod = useMutation({
    mutationFn: (id: string) => apiClient.post(`/governance/periods/${id}/reopen`),
    onSuccess: () => { invalidate(); setErr(''); },
    onError: (e: any) => setErr(getApiErrorMessage(e)),
  });

  return (
    <div className="space-y-5">
      {err && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm flex justify-between">
          {err} <button onClick={() => setErr('')} className="text-red-400 ml-2">✕</button>
        </div>
      )}

      {/* Open new period */}
      {isOwner && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Open a financial period</label>
            <input type="month" className={inputCls} value={newMonth} onChange={e => setNewMonth(e.target.value)} />
          </div>
          <button onClick={() => openPeriod.mutate()}
            className="px-4 py-2.5 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 whitespace-nowrap">
            Open Period
          </button>
        </div>
      )}

      {/* Period list */}
      <div className="space-y-3">
        {periods.data?.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">No financial periods yet</div>
        )}

        {periods.data?.map(period => (
          <div key={period.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50"
              onClick={() => setExpandId(expandId === period.id ? null : period.id)}>
              <div className="flex items-center gap-3">
                <span className="text-lg">{PERIOD_ICON[period.status]}</span>
                <div>
                  <div className="font-semibold text-gray-900">{fmtMonth(period.period_month)}</div>
                  <div className="text-xs text-gray-500">
                    {period.status === 'closed' && period.closed_by_name && `Closed by ${period.closed_by_name} · ${fmtDate(period.closed_at)}`}
                    {period.status === 'locked' && period.locked_by_name && `Locked by ${period.locked_by_name} · ${fmtDate(period.locked_at)}`}
                    {period.status === 'open' && 'Currently open'}
                    {period.force_closed && ' · Force closed'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${PERIOD_BADGE[period.status]}`}>
                  {period.status}
                </span>
                <span className="text-gray-400">{expandId === period.id ? '▲' : '▼'}</span>
              </div>
            </div>

            {expandId === period.id && (
              <div className="border-t border-gray-100 px-4 py-4 space-y-4">

                {/* Force-close notes */}
                {period.force_closed && period.force_close_notes && (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm">
                    <span className="font-medium text-amber-800">Force-close note: </span>
                    <span className="text-amber-700">{period.force_close_notes}</span>
                  </div>
                )}

                {/* Pre-close check results */}
                {preCheck && preCheck.period.id === period.id && (
                  <div className={`rounded-lg border p-4 space-y-2 ${preCheck.can_close ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                    <div className={`font-semibold text-sm ${preCheck.can_close ? 'text-green-800' : 'text-red-800'}`}>
                      {preCheck.can_close ? '✓ Period is ready to close' : '✕ Cannot close — resolve issues first'}
                    </div>
                    {preCheck.blockers.map(b => (
                      <div key={b} className="text-sm text-red-700 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                        {b}
                      </div>
                    ))}
                    {preCheck.warnings.map(w => (
                      <div key={w} className="text-sm text-amber-700 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                        {w}
                      </div>
                    ))}
                    <div className="grid grid-cols-3 gap-3 text-xs text-gray-600 pt-1">
                      <div>Unmatched payments: <strong>{preCheck.unmatched_payments}</strong></div>
                      <div>Open bills: <strong>{preCheck.open_bills}</strong></div>
                      <div>Pending expenses: <strong>{preCheck.pending_expenses}</strong></div>
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap gap-2">
                  {period.status === 'open' && (
                    <>
                      <button onClick={() => runPreCheck(period.id)}
                        className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium hover:bg-gray-50">
                        Run Pre-Close Check
                      </button>
                      {preCheck?.period.id === period.id && preCheck.can_close && (
                        <button onClick={() => closePeriod.mutate(period.id)}
                          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">
                          Close Period
                        </button>
                      )}
                      {isOwner && (
                        <button onClick={() => setShowForce(period.id)}
                          className="px-4 py-2 rounded-lg border border-amber-300 text-amber-700 text-sm font-medium hover:bg-amber-50">
                          Force Close
                        </button>
                      )}
                    </>
                  )}

                  {period.status === 'closed' && isOwner && (
                    <>
                      <button onClick={() => lockPeriod.mutate(period.id)}
                        className="px-4 py-2 rounded-lg bg-gray-700 text-white text-sm font-semibold hover:bg-gray-800">
                        🔒 Lock Period
                      </button>
                      <button onClick={() => reopenPeriod.mutate(period.id)}
                        className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">
                        Reopen
                      </button>
                    </>
                  )}

                  {period.status === 'locked' && (
                    <div className="text-sm text-gray-500 italic py-1">
                      🔒 This period is permanently locked and cannot be modified
                    </div>
                  )}
                </div>

                {/* Force close form */}
                {showForce === period.id && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
                    <div className="font-medium text-amber-800 text-sm">Force Close — owner override</div>
                    <p className="text-xs text-amber-700">This bypasses all blockers. Provide a mandatory justification that will be permanently logged.</p>
                    <textarea
                      className="w-full px-3 py-2 rounded-lg border border-amber-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                      rows={2}
                      placeholder="Justification (minimum 10 characters)…"
                      value={forceNotes}
                      onChange={e => setForceNotes(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <button onClick={() => { setShowForce(null); setForceNotes(''); }}
                        className="px-3 py-2 rounded-lg border border-gray-200 text-sm hover:bg-gray-50">Cancel</button>
                      <button
                        disabled={forceNotes.length < 10 || forceClose.isPending}
                        onClick={() => forceClose.mutate({ id: period.id, notes: forceNotes })}
                        className="px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:opacity-40">
                        Force Close
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Settings Panel ───────────────────────────────────────────────────────────

function GovernanceSettings() {
  const qc = useQueryClient();
  const [threshold, setThreshold] = useState('');
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  void useQuery({
    queryKey: ['governance-settings'],
    queryFn: () => apiClient.get('/governance/settings').then(r => r.data.data as GovSettings),
    onSuccess: (d: GovSettings) => {
      setThreshold(d.expense_approval_threshold != null ? String(d.expense_approval_threshold) : '');
    },
  } as any);

  const save = useMutation({
    mutationFn: () => apiClient.patch('/governance/settings', {
      expense_approval_threshold: threshold ? Number(threshold) : null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['governance-settings'] }); setSaved(true); setTimeout(() => setSaved(false), 2000); },
    onError: (e: any) => setErr(getApiErrorMessage(e)),
  });

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4 max-w-lg">
      <div>
        <h3 className="font-semibold text-gray-900">Expense Approval Threshold</h3>
        <p className="text-sm text-gray-500 mt-0.5">
          Expenses at or above this amount will require finance/owner approval before they count.
          Leave blank to disable the approval workflow.
        </p>
      </div>
      {err && <div className="text-sm text-red-600">{err}</div>}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Threshold (KES)</label>
        <input
          type="number"
          className={inputCls}
          placeholder="e.g. 5000 — leave blank to disable"
          value={threshold}
          onChange={e => setThreshold(e.target.value)}
        />
        {threshold && (
          <p className="text-xs text-teal-600 mt-1">
            Expenses ≥ KES {Number(threshold).toLocaleString()} will be created as pending and need approval
          </p>
        )}
        {!threshold && (
          <p className="text-xs text-gray-400 mt-1">All expenses will be auto-approved</p>
        )}
      </div>
      <button
        onClick={() => save.mutate()}
        disabled={save.isPending}
        className="px-4 py-2.5 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-40">
        {saved ? '✓ Saved' : 'Save Settings'}
      </button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GovernancePage() {
  const { user } = useAuthStore();
  const isOwner   = user?.role === 'owner';
  // isFinance reserved for future role-based UI

  const [tab, setTab] = useState<'approvals' | 'reversals' | 'periods' | 'settings'>('approvals');

  // Pending count badge
  const pending = useQuery({
    queryKey: ['pending-expenses'],
    queryFn: () => apiClient.get('/governance/expenses/pending').then(r => r.data.data as PendingExpense[]),
  });
  const pendingCount = pending.data?.length ?? 0;

  const tabs = [
    { id: 'approvals' as const, label: 'Expense Approvals', badge: pendingCount > 0 ? pendingCount : undefined },
    { id: 'reversals' as const, label: 'Payment Reversals' },
    { id: 'periods'   as const, label: 'Financial Periods' },
    ...(isOwner ? [{ id: 'settings' as const, label: 'Settings' }] : []),
  ];

  return (
    <div className="p-6 ">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Financial Governance</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Expense approvals · Payment reversals · Period close & lock
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit flex-wrap">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
              tab === t.id ? 'bg-white shadow text-teal-700' : 'text-gray-600 hover:text-gray-800'
            }`}>
            {t.label}
            {t.badge != null && (
              <span className="bg-amber-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'approvals' && <ExpenseApprovals isOwner={isOwner} />}
      {tab === 'reversals' && <PaymentReversals isOwner={isOwner} />}
      {tab === 'periods'   && <FinancialPeriods isOwner={isOwner} />}
      {tab === 'settings'  && isOwner && <GovernanceSettings />}
    </div>
  );
}