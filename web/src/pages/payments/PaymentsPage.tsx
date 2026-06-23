// web/src/pages/payments/PaymentsPage.tsx

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, getApiErrorMessage } from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Bill {
  id: string; lease_id: string;
  tenant_name: string; tenant_phone: string;
  unit_number: string; property_name: string;
  for_month: string; due_date: string; bill_type: string;
  rent_amount: string; total_amount: string; total_paid: string; total_due: string;
  status: 'open' | 'partial' | 'overdue' | 'paid' | 'waived' | 'void' | 'draft';
  is_prorated: boolean; proration_description: string | null;
  snap_account_reference: string;
}

interface Payment {
  id: string; amount: string; channel: string;
  tenant_name: string; unit_number: string; property_name: string;
  for_month: string; bill_type: string;
  mpesa_receipt_number: string | null; bank_transaction_ref: string | null;
  receipt_number: string; notes: string | null;
  undo_expires_at: string; undone_at: string | null;
  created_at: string;
}

const inputCls = "w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition placeholder-gray-400";

const KES = (n: string | number) =>
  'KES ' + Number(n).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const MONTH = (d: string) => new Date(d).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
const DATE  = (d: string) => new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });

const STATUS_STYLE: Record<string, string> = {
  open:    'bg-blue-50 text-blue-600',
  partial: 'bg-amber-50 text-amber-700',
  overdue: 'bg-red-50 text-red-600',
  paid:    'bg-emerald-50 text-emerald-700',
  waived:  'bg-gray-100 text-gray-500',
  void:    'bg-gray-100 text-gray-400',
  draft:   'bg-gray-100 text-gray-500',
};

const CHANNEL_LABEL: Record<string, string> = {
  mpesa_paybill: 'M-Pesa PayBill', cash: 'Cash',
  bank_transfer: 'Bank Transfer', adjustment: 'Adjustment',
};

// ─── Record Payment Modal ─────────────────────────────────────────────────────

function RecordPaymentModal({ bill, onClose, onSaved }: {
  bill: Bill; onClose: () => void; onSaved: () => void;
}) {
  // Fetch lease to know deposit status
  const { data: leaseData } = useQuery({
    queryKey: ['lease-deposit', bill.lease_id],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { lease: { deposit_amount: string; deposit_paid_amount: string } } }>(`/leases/${bill.lease_id}`);
      return res.data.data.lease;
    },
  });
  const depositOwed = leaseData
    ? Math.max(0, parseFloat(leaseData.deposit_amount) - parseFloat(leaseData.deposit_paid_amount))
    : 0;

  const [form, setForm] = useState({
    amount: bill.total_due,
    channel: 'cash' as string,
    mpesaReceiptNumber: '',
    mpesaPhone: '',
    bankTransactionRef: '',
    bankName: '',
    bankTransactionDate: '',
    notes: '',
    recordedAt: new Date().toISOString().slice(0, 16),
    splitDeposit: false,
    depositAmount: '0',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  async function submit() {
    const amt = parseFloat(form.amount);
    if (!amt || amt <= 0) { setError('Enter a valid amount'); return; }
    if (form.splitDeposit) {
      const depAmt = parseFloat(form.depositAmount || '0');
      const rentPortion = amt - depAmt;
      if (depAmt <= 0) { setError('Enter a deposit amount to split'); return; }
      if (rentPortion < 0) { setError('Total amount must be at least the deposit portion'); return; }
    }
    if (form.channel === 'mpesa_paybill' && !form.mpesaReceiptNumber) {
      setError('M-Pesa receipt number is required'); return;
    }
    if (form.channel === 'bank_transfer' && !form.bankTransactionRef) {
      setError('Bank transaction reference is required'); return;
    }
    setError(''); setLoading(true);
    try {
      const depositAlloc = form.splitDeposit ? parseFloat(form.depositAmount || '0') : 0;
      await apiClient.post('/payments', {
        billId:             bill.id,
        amount:             amt,
        channel:            form.channel,
        mpesaReceiptNumber: form.mpesaReceiptNumber || null,
        mpesaPhone:         form.mpesaPhone || null,
        bankTransactionRef: form.bankTransactionRef || null,
        bankName:           form.bankName || null,
        bankTransactionDate:form.bankTransactionDate || null,
        notes:              form.notes || null,
        recordedAt:         new Date(form.recordedAt).toISOString(),
        depositAmount:      depositAlloc > 0 ? depositAlloc : undefined,
      });
      onSaved();
    } catch (e) { setError(getApiErrorMessage(e)); }
    finally { setLoading(false); }
  }

  const outstanding = parseFloat(bill.total_due);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Record Payment</h2>
            <p className="text-xs text-gray-400 mt-0.5">{bill.tenant_name} · Unit {bill.unit_number}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[30rem] overflow-y-auto">
          {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}

          {/* Bill summary */}
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs text-gray-500">{MONTH(bill.for_month)} · {bill.bill_type === 'signing' ? 'Signing Bill' : 'Rent'}</p>
                <p className="text-lg font-bold text-gray-900">{KES(bill.total_amount)}</p>
                {bill.is_prorated && bill.proration_description && (
                  <p className="text-xs text-gray-400 mt-0.5">{bill.proration_description}</p>
                )}
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500">Outstanding</p>
                <p className="text-lg font-bold text-red-600">{KES(outstanding)}</p>
              </div>
            </div>
            {parseFloat(bill.total_paid) > 0 && (
              <div className="mt-2 pt-2 border-t border-gray-200">
                <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-500"
                    style={{ width: `${Math.min(100, (parseFloat(bill.total_paid) / parseFloat(bill.total_amount)) * 100)}%` }} />
                </div>
                <p className="text-xs text-gray-400 mt-1">{KES(bill.total_paid)} already paid</p>
              </div>
            )}
            <p className="text-xs text-gray-400 mt-2">Ref: {bill.snap_account_reference}</p>
          </div>

          {/* Amount */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-gray-700">Amount (KES) *</label>
              <button type="button"
                onClick={() => {
                  const total = outstanding + (form.splitDeposit ? depositOwed : 0);
                  set('amount', String(total));
                }}
                className="text-xs font-medium px-2 py-0.5 rounded-lg transition"
                style={{ color: '#0d9f9f', background: '#f0fdfa' }}>
                Max: {KES(form.splitDeposit ? outstanding + depositOwed : outstanding)}
              </button>
            </div>
            <input type="number" value={form.amount}
              onChange={e => set('amount', e.target.value)}
              min={1} className={inputCls} />
          </div>

          {/* Split deposit toggle — only shown if deposit is still owed */}
          {depositOwed > 0 && (
            <label className={`flex items-start gap-3 p-3.5 rounded-xl border-2 cursor-pointer transition
              ${form.splitDeposit ? 'border-teal-500 bg-teal-50' : 'border-gray-200 hover:border-gray-300'}`}>
              <input type="checkbox" checked={form.splitDeposit}
                onChange={e => {
                  set('splitDeposit', String(e.target.checked));
                  if (e.target.checked) {
                    // Auto-set total to rent + deposit
                    set('amount', String(outstanding + depositOwed));
                    set('depositAmount', String(depositOwed));
                  } else {
                    set('amount', bill.total_due);
                    set('depositAmount', '0');
                  }
                }}
                className="mt-0.5 accent-teal-500" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800">This payment also covers the deposit</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Deposit outstanding: {KES(depositOwed)}
                </p>
                {form.splitDeposit && (
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-white rounded-lg p-2 border border-teal-200">
                      <p className="text-gray-500">Rent portion</p>
                      <p className="font-bold text-gray-900">{KES(Math.max(0, parseFloat(form.amount||'0') - parseFloat(form.depositAmount||'0')))}</p>
                    </div>
                    <div className="bg-white rounded-lg p-2 border border-teal-200">
                      <p className="text-gray-500">Deposit portion</p>
                      <input type="number"
                        value={form.depositAmount}
                        onChange={e => set('depositAmount', e.target.value)}
                        max={depositOwed}
                        className="w-full font-bold text-gray-900 bg-transparent outline-none text-xs mt-0.5" />
                    </div>
                  </div>
                )}
              </div>
            </label>
          )}

          {/* Channel */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Payment Channel *</label>
            <div className="grid grid-cols-2 gap-2">
              {(['cash','mpesa_paybill','bank_transfer','adjustment'] as const).map(ch => (
                <button key={ch} onClick={() => set('channel', ch)}
                  className={`py-2.5 px-3 rounded-xl text-sm font-medium border-2 transition text-left
                    ${form.channel === ch ? 'border-teal-500 bg-teal-50 text-teal-800' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                  {ch === 'cash' && '💵 '}
                  {ch === 'mpesa_paybill' && '📱 '}
                  {ch === 'bank_transfer' && '🏦 '}
                  {ch === 'adjustment' && '⚙️ '}
                  {CHANNEL_LABEL[ch]}
                </button>
              ))}
            </div>
          </div>

          {/* M-Pesa fields */}
          {form.channel === 'mpesa_paybill' && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">M-Pesa Receipt Number *</label>
                <input value={form.mpesaReceiptNumber} onChange={e => set('mpesaReceiptNumber', e.target.value.toUpperCase())}
                  placeholder="QAB1234XYZ" className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Paying Phone</label>
                <input value={form.mpesaPhone} onChange={e => set('mpesaPhone', e.target.value)}
                  placeholder="+254 700 000 000" className={inputCls} />
              </div>
            </div>
          )}

          {/* Bank fields */}
          {form.channel === 'bank_transfer' && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Transaction Reference *</label>
                <input value={form.bankTransactionRef} onChange={e => set('bankTransactionRef', e.target.value)}
                  placeholder="TXN123456" className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Bank Name</label>
                  <input value={form.bankName} onChange={e => set('bankName', e.target.value)}
                    placeholder="KCB, Equity…" className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Transaction Date</label>
                  <input type="date" value={form.bankTransactionDate} onChange={e => set('bankTransactionDate', e.target.value)}
                    className={inputCls} />
                </div>
              </div>
            </div>
          )}

          {/* Date + Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Recorded At</label>
            <input type="datetime-local" value={form.recordedAt} onChange={e => set('recordedAt', e.target.value)}
              className={inputCls} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes</label>
            <input value={form.notes} onChange={e => set('notes', e.target.value)}
              placeholder="Optional notes…" className={inputCls} />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition">Cancel</button>
          <button onClick={submit} disabled={loading}
            className="px-5 py-2 rounded-lg text-sm font-semibold text-white transition disabled:opacity-60 flex items-center gap-2"
            style={{ background: '#0d9f9f' }}>
            {loading && <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
            Record Payment
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Bill Card ────────────────────────────────────────────────────────────────

function BillCard({ bill, onPay }: { bill: Bill; onPay: (b: Bill) => void }) {
  const pct = Math.min(100, (parseFloat(bill.total_paid) / parseFloat(bill.total_amount)) * 100);
  const canPay = ['open','partial','overdue'].includes(bill.status);
  const isOverdue = bill.status === 'overdue' || (bill.status !== 'paid' && new Date(bill.due_date) < new Date());

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all group overflow-hidden">
      <div className="h-1" style={{
        background: bill.status === 'paid' ? 'linear-gradient(90deg,#10b981,#059669)' :
                    isOverdue              ? 'linear-gradient(90deg,#ef4444,#dc2626)' :
                    bill.status === 'partial' ? 'linear-gradient(90deg,#f59e0b,#d97706)' :
                    'linear-gradient(90deg,#0d9f9f,#076666)'
      }} />
      <div className="p-5">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 truncate">{bill.tenant_name}</p>
            <p className="text-xs text-gray-400 mt-0.5">Unit {bill.unit_number} · {bill.property_name}</p>
          </div>
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold shrink-0 capitalize ${STATUS_STYLE[bill.status]}`}>
            {bill.status}
          </span>
        </div>

        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs text-gray-500">{MONTH(bill.for_month)}</p>
            <p className="text-lg font-bold text-gray-900">{KES(bill.total_amount)}</p>
          </div>
          {canPay && parseFloat(bill.total_due) > 0 && (
            <div className="text-right">
              <p className="text-xs text-gray-400">Outstanding</p>
              <p className="text-base font-bold" style={{ color: isOverdue ? '#ef4444' : '#374151' }}>
                {KES(bill.total_due)}
              </p>
            </div>
          )}
        </div>

        {/* Progress bar */}
        {parseFloat(bill.total_paid) > 0 && (
          <div className="mb-3">
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, background: pct >= 100 ? '#10b981' : '#f59e0b' }} />
            </div>
            <p className="text-xs text-gray-400 mt-1">{KES(bill.total_paid)} paid</p>
          </div>
        )}

        <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
          <span>Due {DATE(bill.due_date)}</span>
          <span className="font-mono">{bill.snap_account_reference}</span>
        </div>

        {bill.is_prorated && (
          <p className="text-xs text-gray-400 mb-3 truncate">{bill.proration_description}</p>
        )}

        {canPay && (
          <button onClick={() => onPay(bill)}
            className="w-full mt-3 py-2 rounded-xl text-sm font-semibold text-white transition opacity-0 group-hover:opacity-100"
            style={{ background: '#0d9f9f' }}>
            Record Payment
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Payment Row ──────────────────────────────────────────────────────────────

function PaymentRow({ payment, onUndo }: { payment: Payment; onUndo: (p: Payment) => void }) {
  const canUndo = !payment.undone_at && new Date() < new Date(payment.undo_expires_at);
  return (
    <div className={`flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition rounded-xl ${payment.undone_at ? 'opacity-40' : ''}`}>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-lg"
        style={{ background: payment.channel === 'mpesa_paybill' ? '#dcfce7' : payment.channel === 'cash' ? '#fef9c3' : '#e0f2fe' }}>
        {payment.channel === 'mpesa_paybill' ? '📱' : payment.channel === 'cash' ? '💵' : payment.channel === 'bank_transfer' ? '🏦' : '⚙️'}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{payment.tenant_name}</p>
        <p className="text-xs text-gray-400">
          Unit {payment.unit_number} · {MONTH(payment.for_month)}
          {payment.mpesa_receipt_number && ` · ${payment.mpesa_receipt_number}`}
          {payment.bank_transaction_ref && ` · ${payment.bank_transaction_ref}`}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-bold text-gray-900">{KES(payment.amount)}</p>
        <p className="text-xs text-gray-400">{DATE(payment.created_at)}</p>
      </div>
      {canUndo && (
        <button onClick={() => onUndo(payment)}
          className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded-lg hover:bg-red-50 transition shrink-0">
          Undo
        </button>
      )}
      {payment.undone_at && (
        <span className="text-xs text-gray-400 shrink-0">Undone</span>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PaymentsPage() {
  const qc = useQueryClient();
  const [tab,      setTab]      = useState<'bills' | 'history'>('bills');
  const [paying,   setPaying]   = useState<Bill | null>(null);
  const [billFilter] = useState<'unpaid' | 'all'>('unpaid');

  const { data: bills, isLoading: loadingBills } = useQuery({
    queryKey: ['bills', billFilter],
    queryFn: async () => {
      const status = billFilter === 'unpaid' ? '' : 'all';
      const url = status ? '/payments/bills' : '/payments/bills';
      const res = await apiClient.get<{ data: { bills: Bill[] } }>(url);
      return res.data.data.bills;
    },
  });

  const { data: payments, isLoading: loadingPayments } = useQuery({
    queryKey: ['payments'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { payments: Payment[] } }>('/payments');
      return res.data.data.payments;
    },
    enabled: tab === 'history',
  });

  const { data: summary } = useQuery({
    queryKey: ['payments-summary'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { summary: { collected_mtd: string; total_outstanding: string; overdue_count: string } } }>('/payments/summary');
      return res.data.data.summary;
    },
  });

  async function undoPayment(payment: Payment) {
    try {
      await apiClient.post(`/payments/${payment.id}/undo`, {});
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['bills'] });
      qc.invalidateQueries({ queryKey: ['payments-summary'] });
    } catch (e) { alert(getApiErrorMessage(e)); }
  }

  function refresh() {
    qc.invalidateQueries({ queryKey: ['bills'] });
    qc.invalidateQueries({ queryKey: ['payments'] });
    qc.invalidateQueries({ queryKey: ['payments-summary'] });
    qc.invalidateQueries({ queryKey: ['leases'] });
    setPaying(null);
  }

  const overdueCount = (bills ?? []).filter(b => b.status === 'overdue' || (b.status !== 'paid' && new Date(b.due_date) < new Date())).length;

  return (
    <div className="p-6 lg:p-8 ">

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Payments</h1>
        <p className="text-sm text-gray-500 mt-0.5">Record and track rent payments</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Collected (MTD)',   value: summary ? KES(summary.collected_mtd)    : '…', color: '#10b981' },
          { label: 'Outstanding',       value: summary ? KES(summary.total_outstanding) : '…', color: '#f59e0b' },
          { label: 'Overdue Bills',     value: summary ? summary.overdue_count          : '…', color: '#ef4444' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{s.label}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit">
        {(['bills','history'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition capitalize
              ${tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t === 'bills' ? `Outstanding Bills${overdueCount > 0 ? ` (${overdueCount} overdue)` : ''}` : 'Payment History'}
          </button>
        ))}
      </div>

      {/* Bills tab */}
      {tab === 'bills' && (
        <>
          {loadingBills && (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
                style={{ borderColor: '#0d9f9f', borderTopColor: 'transparent' }} />
            </div>
          )}
          {!loadingBills && bills && bills.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                style={{ background: 'linear-gradient(135deg,#e6fafa,#b2eded)' }}>
                <svg className="w-8 h-8" style={{ color: '#0d9f9f' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-gray-900 mb-1">All caught up!</h3>
              <p className="text-sm text-gray-500">No outstanding bills at the moment</p>
            </div>
          )}
          {!loadingBills && bills && bills.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {bills.map(b => (
                <BillCard key={b.id} bill={b} onPay={setPaying} />
              ))}
            </div>
          )}
        </>
      )}

      {/* History tab */}
      {tab === 'history' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {loadingPayments && (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
                style={{ borderColor: '#0d9f9f', borderTopColor: 'transparent' }} />
            </div>
          )}
          {!loadingPayments && payments && payments.length === 0 && (
            <div className="text-center py-16">
              <p className="text-sm text-gray-500">No payments recorded yet</p>
            </div>
          )}
          {!loadingPayments && payments && payments.length > 0 && (
            <div className="divide-y divide-gray-50 p-2">
              {payments.map(p => (
                <PaymentRow key={p.id} payment={p} onUndo={undoPayment} />
              ))}
            </div>
          )}
        </div>
      )}

      {paying && <RecordPaymentModal bill={paying} onClose={() => setPaying(null)} onSaved={refresh} />}
    </div>
  );
}