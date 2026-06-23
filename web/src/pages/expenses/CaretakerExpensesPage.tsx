// web/src/pages/expenses/CaretakerExpensesPage.tsx

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, getApiErrorMessage } from '../../lib/api';

const CATEGORIES = [
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'utilities',   label: 'Utilities' },
  { value: 'cleaning',    label: 'Cleaning' },
  { value: 'security',    label: 'Security' },
  { value: 'admin',       label: 'Admin' },
  { value: 'other',       label: 'Other' },
];

const STATUS_STYLE: Record<string, string> = {
  pending:  'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

const KES = (n: string | number) =>
  'KES ' + Number(n).toLocaleString('en-KE', { maximumFractionDigits: 0 });

const FMT = (d: string) =>
  new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });

const inputCls = 'w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white';

export default function CaretakerExpensesPage() {
  const qc = useQueryClient();
  const [showForm,     setShowForm]     = useState(false);
  const [err,          setErr]          = useState('');
  const [success,      setSuccess]      = useState('');

  // Form state
  const [propertyId,   setPropertyId]   = useState('');
  const [category,     setCategory]     = useState('maintenance');
  const [description,  setDescription]  = useState('');
  const [amount,       setAmount]       = useState('');
  const [expenseDate,  setExpenseDate]  = useState(new Date().toISOString().slice(0, 10));
  const [vendorName,   setVendorName]   = useState('');
  const [notes,        setNotes]        = useState('');

  // Load my properties
  const { data: propertiesData } = useQuery({
    queryKey: ['caretaker-properties'],
    queryFn: () => apiClient.get('/properties').then(r => r.data.data.properties ?? []),
  });

  // Load my expense requests
  const { data: expensesData, isLoading } = useQuery({
    queryKey: ['caretaker-expenses'],
    queryFn: () => apiClient.get('/caretaker-expenses').then(r => r.data.data.expenses ?? []),
  });

  const submit = useMutation({
    mutationFn: () => apiClient.post('/caretaker-expenses', {
      property_id:  propertyId,
      category,
      description,
      amount:       parseFloat(amount),
      expense_date: expenseDate,
      vendor_name:  vendorName || undefined,
      notes:        notes || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['caretaker-expenses'] });
      setSuccess('Expense request submitted — it will be reviewed by your manager.');
      setErr('');
      setShowForm(false);
      setDescription(''); setAmount(''); setVendorName(''); setNotes('');
      setPropertyId(''); setCategory('maintenance');
      setTimeout(() => setSuccess(''), 5000);
    },
    onError: (e: any) => setErr(getApiErrorMessage(e)),
  });

  const properties: any[] = propertiesData ?? [];
  const expenses:   any[] = expensesData   ?? [];

  const pendingCount  = expenses.filter(e => e.approval_status === 'pending').length;
  const approvedTotal = expenses
    .filter(e => e.approval_status === 'approved')
    .reduce((s, e) => s + Number(e.amount), 0);

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Expense Requests</h1>
          <p className="text-sm text-gray-500 mt-0.5">Submit expenses for manager approval</p>
        </div>
        <button onClick={() => { setShowForm(true); setErr(''); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm hover:shadow-md transition"
          style={{ background: 'linear-gradient(135deg,#0d9f9f,#076666)' }}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Request
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="text-xs text-gray-500 mb-1">Pending Approval</div>
          <div className="text-2xl font-bold text-amber-600">{pendingCount}</div>
          <div className="text-xs text-gray-400">awaiting review</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="text-xs text-gray-500 mb-1">Approved Total</div>
          <div className="text-2xl font-bold text-green-600">{KES(approvedTotal)}</div>
          <div className="text-xs text-gray-400">all time</div>
        </div>
      </div>

      {success && (
        <div className="mb-5 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
          ✅ {success}
        </div>
      )}

      {/* New Request Form */}
      {showForm && (
        <div className="mb-6 bg-white rounded-2xl border border-teal-200 shadow-sm p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-semibold text-gray-900">New Expense Request</h2>
            <button onClick={() => { setShowForm(false); setErr(''); }}
              className="text-gray-400 hover:text-gray-600 transition">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Property *</label>
              <select className={inputCls} value={propertyId} onChange={e => setPropertyId(e.target.value)}>
                <option value="">Select property…</option>
                {properties.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
              <select className={inputCls} value={category} onChange={e => setCategory(e.target.value)}>
                {CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
              <input type="date" className={inputCls} value={expenseDate}
                onChange={e => setExpenseDate(e.target.value)} />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Description *</label>
              <input className={inputCls} value={description}
                placeholder="e.g. Replaced broken tap in unit 3A"
                onChange={e => setDescription(e.target.value)} />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount (KES) *</label>
              <input type="number" className={inputCls} value={amount} min="0"
                placeholder="0" onChange={e => setAmount(e.target.value)} />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vendor / Supplier</label>
              <input className={inputCls} value={vendorName}
                placeholder="e.g. Nairobi Plumbing Supplies"
                onChange={e => setVendorName(e.target.value)} />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Additional Notes</label>
              <textarea className={inputCls} rows={2} value={notes}
                placeholder="Any supporting details…"
                onChange={e => setNotes(e.target.value)} />
            </div>
          </div>

          {err && (
            <div className="mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{err}</div>
          )}

          <div className="flex justify-end gap-3 mt-5">
            <button onClick={() => { setShowForm(false); setErr(''); }}
              className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 transition">
              Cancel
            </button>
            <button
              onClick={() => submit.mutate()}
              disabled={submit.isPending || !propertyId || !description || !amount}
              className="px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition flex items-center gap-2"
              style={{ background: '#0d9f9f' }}>
              {submit.isPending && (
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              )}
              Submit Request
            </button>
          </div>
        </div>
      )}

      {/* Expenses list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: '#0d9f9f', borderTopColor: 'transparent' }} />
        </div>
      ) : expenses.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'linear-gradient(135deg,#e6fafa,#b2eded)' }}>
            <svg className="w-8 h-8" style={{ color: '#0d9f9f' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-gray-900 mb-1">No expense requests yet</h3>
          <p className="text-sm text-gray-500 mb-5">Submit your first expense request for approval</p>
          <button onClick={() => setShowForm(true)}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ background: '#0d9f9f' }}>
            Submit First Request
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {expenses.map((e: any) => (
            <div key={e.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_STYLE[e.approval_status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {e.approval_status}
                    </span>
                    <span className="text-xs text-gray-400 capitalize">{e.category}</span>
                    <span className="text-xs text-gray-400">{FMT(e.expense_date)}</span>
                  </div>
                  <p className="font-semibold text-gray-900">{e.description}</p>
                  {e.property_name && (
                    <p className="text-xs text-gray-500 mt-0.5">{e.property_name}</p>
                  )}
                  {e.vendor_name && (
                    <p className="text-xs text-gray-400 mt-0.5">Vendor: {e.vendor_name}</p>
                  )}
                  {e.approval_status === 'rejected' && e.approval_notes && (
                    <div className="mt-2 p-2 rounded-lg bg-red-50 border border-red-100 text-xs text-red-700">
                      Reason: {e.approval_notes}
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-lg font-bold text-gray-900">{KES(e.amount)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}