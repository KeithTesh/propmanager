// web/src/pages/expenses/ExpensesPage.tsx

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, getApiErrorMessage } from '../../lib/api';

interface Expense {
  id: string;
  property_id: string | null; property_name: string | null;
  unit_id: string | null; unit_number: string | null;
  category: string; description: string;
  amount: string; expense_date: string;
  paid_by: string | null; vendor_name: string | null;
  is_tenant_chargeable: boolean;
  charged_to_bill_id: string | null;
  recorded_by_name: string | null;
}

interface Property { id: string; name: string; }

const CATEGORIES = [
  'maintenance','utilities','staff','insurance',
  'cleaning','security','admin','legal','tax','other'
];

const CAT_COLOR: Record<string, string> = {
  maintenance: '#f59e0b', utilities: '#3b82f6', staff: '#8b5cf6',
  insurance: '#0d9f9f', cleaning: '#10b981', security: '#ef4444',
  admin: '#6b7280', legal: '#ec4899', tax: '#f97316', other: '#9ca3af',
};

const KES = (n: string | number) =>
  'KES ' + Number(n).toLocaleString('en-KE', { maximumFractionDigits: 0 });
const fmtDate = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
const inputCls  = 'w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500';
const selectCls = inputCls;
const EMPTY = {
  property_id: '', unit_id: '', category: 'maintenance', description: '',
  amount: '', expense_date: new Date().toISOString().slice(0, 10),
  paid_by: '', vendor_name: '', is_tenant_chargeable: false,
};

export default function ExpensesPage() {
  const qc = useQueryClient();
  const [showForm,     setShowForm]     = useState(false);
  const [editId,       setEditId]       = useState<string | null>(null);
  const [form,         setForm]         = useState({ ...EMPTY });
  const [saving,       setSaving]       = useState(false);
  const [deleting,     setDeleting]     = useState<string | null>(null);
  const [error,        setError]        = useState('');
  const [filterCat,    setFilterCat]    = useState('');
  const [filterProp,   setFilterProp]   = useState('');
  const [filterFrom,   setFilterFrom]   = useState('');
  const [filterTo,     setFilterTo]     = useState('');
  const [showBreakdown,setShowBreakdown]= useState(false);
  // Charge-to-tenant state
  const [chargeExpense, setChargeExpense] = useState<Expense | null>(null);
  const [chargeMode,    setChargeMode]    = useState<'single'|'split'|'each'>('single');
  const [chargeMonth,   setChargeMonth]   = useState(
    new Date().toISOString().slice(0, 7) + '-01'
  );
  const [chargeDesc,    setChargeDesc]    = useState('');
  const [charging,      setCharging]      = useState(false);
  const [chargeResult,  setChargeResult]  = useState<{ charged: number; per_unit_amount: number; message: string } | null>(null);
  const [chargeError,   setChargeError]   = useState('');

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const { data: properties } = useQuery<Property[]>({
    queryKey: ['properties-list'],
    queryFn: async () => {
      const r = await apiClient.get<{ data: { properties: Property[] } }>('/properties');
      return r.data.data.properties;
    },
  });

  const { data: units } = useQuery({
    queryKey: ['units-for-prop', form.property_id],
    queryFn: async () => {
      const r = await apiClient.get<{ data: { units: { id: string; unit_number: string }[] } }>(
        `/units?property_id=${form.property_id}`
      );
      return r.data.data.units;
    },
    enabled: !!form.property_id,
  });

  const params = new URLSearchParams();
  if (filterCat)  params.set('category',    filterCat);
  if (filterProp) params.set('property_id', filterProp);
  if (filterFrom) params.set('from',        filterFrom);
  if (filterTo)   params.set('to',          filterTo);

  const { data, isLoading } = useQuery({
    queryKey: ['expenses', filterCat, filterProp, filterFrom, filterTo],
    queryFn: async () => {
      const r = await apiClient.get<{ data: { expenses: Expense[]; totals: { total_count: string; total_amount: string; amount_mtd: string } } }>(
        `/expenses?${params}`
      );
      return r.data.data;
    },
  });

  const { data: summary } = useQuery({
    queryKey: ['expenses-summary', filterFrom, filterTo],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (filterFrom) p.set('from', filterFrom);
      if (filterTo)   p.set('to',   filterTo);
      const r = await apiClient.get<{ data: { breakdown: { category: string; count: string; total: string }[]; grand_total: string } }>(
        `/expenses/summary?${p}`
      );
      return r.data.data;
    },
    enabled: showBreakdown,
  });

  function openAdd() {
    setForm({ ...EMPTY }); setEditId(null); setError(''); setShowForm(true);
  }

  function openEdit(e: Expense) {
    setForm({
      property_id: e.property_id ?? '', unit_id: e.unit_id ?? '',
      category: e.category, description: e.description, amount: e.amount,
      expense_date: e.expense_date.slice(0, 10),
      paid_by: e.paid_by ?? '', vendor_name: e.vendor_name ?? '',
      is_tenant_chargeable: e.is_tenant_chargeable,
    });
    setEditId(e.id); setError(''); setShowForm(true);
  }

  function openCharge(e: Expense) {
    setChargeExpense(e);
    setChargeMode(e.unit_id ? 'single' : e.property_id ? 'each' : 'single');
    setChargeMonth(new Date().toISOString().slice(0, 7) + '-01');
    setChargeDue(new Date().toISOString().slice(0, 10));
    setChargeDesc('');
    setChargeResult(null);
    setChargeError('');
  }

  async function submitCharge() {
    if (!chargeExpense) return;
    setCharging(true); setChargeError(''); setChargeResult(null);
    try {
      const res = await apiClient.post<{ data: { charged: number; per_unit_amount: number; message: string } }>(
        `/expenses/${chargeExpense.id}/charge-to-tenant`,
        { charge_mode: chargeMode, for_month: chargeMonth, description: chargeDesc || undefined }
      );
      setChargeResult(res.data.data);
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['billing-bills'] });
    } catch (e) { setChargeError(getApiErrorMessage(e)); }
    finally { setCharging(false); }
  }

  async function save() {
    setSaving(true); setError('');
    const payload = {
      ...form,
      property_id: form.property_id || null,
      unit_id:     form.unit_id     || null,
      paid_by:     form.paid_by     || null,
      vendor_name: form.vendor_name || null,
      amount:      parseFloat(form.amount),
    };
    try {
      if (editId) await apiClient.patch(`/expenses/${editId}`, payload);
      else        await apiClient.post('/expenses', payload);
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['expenses-summary'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      setShowForm(false);
    } catch (e) { setError(getApiErrorMessage(e)); }
    finally { setSaving(false); }
  }

  async function del(id: string) {
    if (!confirm('Delete this expense?')) return;
    setDeleting(id);
    try {
      await apiClient.delete(`/expenses/${id}`);
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['expenses-summary'] });
    } catch (e) { alert(getApiErrorMessage(e)); }
    finally { setDeleting(null); }
  }

  const expenses = data?.expenses ?? [];
  const totals   = data?.totals;

  return (
    <div className="p-6 lg:p-8 ">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Expenses</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track operating costs by property and category</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowBreakdown(v => !v)}
            className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold border transition
              ${showBreakdown ? 'bg-teal-50 border-teal-200 text-teal-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
            </svg>
            Breakdown
          </button>
          <button onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ background: 'linear-gradient(135deg,#0d9f9f,#076666)' }}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Expense
          </button>
        </div>
      </div>

      {/* KPI cards */}
      {totals && (
        <div className="grid grid-cols-3 gap-4 mb-5">
          {[
            { label: 'Total (filtered)', value: KES(totals.total_amount), sub: `${totals.total_count} records` },
            { label: 'This Month',       value: KES(totals.amount_mtd),   sub: 'Month to date' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm col-span-1">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{s.label}</p>
              <p className="text-xl font-bold text-gray-900 mt-1">{s.value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* Breakdown panel */}
      {showBreakdown && summary && (
        <div className="mb-5 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="text-sm font-bold text-gray-800">Spend by Category</h2>
          </div>
          <div className="p-5 grid grid-cols-2 lg:grid-cols-5 gap-3">
            {summary.breakdown.map(b => {
              const pct = Number(summary.grand_total) > 0
                ? Math.round((Number(b.total) / Number(summary.grand_total)) * 100) : 0;
              return (
                <div key={b.category} className="rounded-xl p-3 border"
                  style={{ borderColor: (CAT_COLOR[b.category] ?? '#6b7280') + '40', background: (CAT_COLOR[b.category] ?? '#6b7280') + '0d' }}>
                  <p className="text-xs font-semibold capitalize" style={{ color: CAT_COLOR[b.category] ?? '#6b7280' }}>{b.category}</p>
                  <p className="text-base font-bold text-gray-900 mt-1">{KES(b.total)}</p>
                  <p className="text-xs text-gray-400">{b.count} · {pct}%</p>
                  <div className="mt-2 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: CAT_COLOR[b.category] ?? '#6b7280' }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex justify-between">
            <span className="text-xs text-gray-500">Grand total</span>
            <span className="text-sm font-bold text-gray-900">{KES(summary.grand_total)}</span>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white">
          <option value="">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
        </select>
        <select value={filterProp} onChange={e => setFilterProp(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white">
          <option value="">All properties</option>
          {(properties ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
        <span className="text-gray-400 text-sm">to</span>
        <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
        {(filterCat || filterProp || filterFrom || filterTo) && (
          <button onClick={() => { setFilterCat(''); setFilterProp(''); setFilterFrom(''); setFilterTo(''); }}
            className="px-3 py-2 rounded-lg text-xs font-medium text-gray-500 hover:text-red-500 border border-gray-200 bg-white transition">
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor:'#0d9f9f', borderTopColor:'transparent' }} />
        </div>
      ) : expenses.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background:'linear-gradient(135deg,#e6fafa,#b2eded)' }}>
            <svg className="w-8 h-8" style={{ color:'#0d9f9f' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-gray-900 mb-1">No expenses yet</h3>
          <p className="text-sm text-gray-500 mb-4">Start tracking your operating costs.</p>
          <button onClick={openAdd} className="px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{ background:'linear-gradient(135deg,#0d9f9f,#076666)' }}>
            Add First Expense
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                {['Date','Category','Description','Property / Unit','Amount','Paid By','',''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {expenses.map(e => (
                <tr key={e.id} className="hover:bg-gray-50 transition">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">{fmtDate(e.expense_date)}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold capitalize"
                      style={{ background:(CAT_COLOR[e.category]??'#6b7280')+'18', color:CAT_COLOR[e.category]??'#6b7280' }}>
                      {e.category}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900 max-w-xs truncate">{e.description}</p>
                    {e.vendor_name && <p className="text-xs text-gray-400">{e.vendor_name}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-sm">
                    {e.property_name
                      ? <div><p>{e.property_name}</p>{e.unit_number && <p className="text-xs text-gray-400">Unit {e.unit_number}</p>}</div>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 font-semibold text-gray-900">{KES(e.amount)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{e.paid_by ?? '—'}</td>
                  <td className="px-4 py-3">
                    {e.is_tenant_chargeable && (
                      e.charged_to_bill_id
                        ? <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-full font-medium">Charged ✓</span>
                        : <span className="text-xs bg-amber-50 text-amber-700 border border-amber-100 px-2 py-0.5 rounded-full font-medium">Chargeable</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {e.is_tenant_chargeable && !e.charged_to_bill_id && (
                        <button onClick={() => openCharge(e)}
                          className="text-xs font-semibold text-amber-600 hover:text-amber-800 transition border border-amber-200 bg-amber-50 hover:bg-amber-100 px-2 py-1 rounded-lg">
                          Charge →
                        </button>
                      )}
                      <button onClick={() => openEdit(e)} className="text-xs text-gray-400 hover:text-teal-600 transition font-medium">Edit</button>
                      <button onClick={() => del(e.id)} disabled={deleting === e.id}
                        className="text-xs text-gray-300 hover:text-red-400 transition font-medium disabled:opacity-50">
                        {deleting === e.id ? '…' : 'Delete'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background:'rgba(0,0,0,0.45)', backdropFilter:'blur(4px)' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-6 pt-6 pb-4 border-b border-gray-100">
              <h3 className="text-base font-bold text-gray-900">{editId ? 'Edit Expense' : 'Add Expense'}</h3>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Date *</label>
                  <input type="date" value={form.expense_date} onChange={e => set('expense_date', e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Category *</label>
                  <select value={form.category} onChange={e => set('category', e.target.value)} className={selectCls}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Description *</label>
                <input value={form.description} onChange={e => set('description', e.target.value)}
                  placeholder="e.g. Plumber repair, electricity bill…" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Amount (KES) *</label>
                <input type="number" min={0} step="0.01" value={form.amount}
                  onChange={e => set('amount', e.target.value)} placeholder="0.00" className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Property</label>
                  <select value={form.property_id} onChange={e => { set('property_id', e.target.value); set('unit_id', ''); }} className={selectCls}>
                    <option value="">All properties</option>
                    {(properties ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Unit</label>
                  <select value={form.unit_id} onChange={e => set('unit_id', e.target.value)} disabled={!form.property_id} className={selectCls}>
                    <option value="">Whole property</option>
                    {(units ?? []).map(u => <option key={u.id} value={u.id}>Unit {u.unit_number}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Vendor</label>
                  <input value={form.vendor_name} onChange={e => set('vendor_name', e.target.value)}
                    placeholder="e.g. Nairobi Water Co." className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Paid By</label>
                  <input value={form.paid_by} onChange={e => set('paid_by', e.target.value)}
                    placeholder="e.g. Petty cash, bank" className={inputCls} />
                </div>
              </div>
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <div className={`relative w-10 h-5 rounded-full transition-colors ${form.is_tenant_chargeable ? 'bg-amber-500' : 'bg-gray-200'}`}
                  onClick={() => set('is_tenant_chargeable', !form.is_tenant_chargeable)}>
                  <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.is_tenant_chargeable ? 'translate-x-5' : ''}`} />
                </div>
                <span className="text-sm text-gray-700">Tenant-chargeable expense</span>
              </label>
              {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
            </div>
            <div className="px-6 pb-6 flex justify-end gap-3">
              <button onClick={() => setShowForm(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition">Cancel</button>
              <button onClick={save} disabled={saving || !form.description || !form.amount || !form.expense_date}
                className="px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition"
                style={{ background:'linear-gradient(135deg,#0d9f9f,#076666)' }}>
                {saving ? 'Saving…' : editId ? 'Save Changes' : 'Add Expense'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Charge-to-Tenant Modal */}
      {chargeExpense && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background:'rgba(0,0,0,0.45)', backdropFilter:'blur(4px)' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 pt-6 pb-4 border-b border-gray-100">
              <h3 className="text-base font-bold text-gray-900">Charge to Tenant(s)</h3>
              <p className="text-sm text-gray-500 mt-0.5">
                {chargeExpense.description} · <strong>{KES(chargeExpense.amount)}</strong>
              </p>
            </div>
            <div className="px-6 py-5 space-y-4">

              {/* Charge mode */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">Charge Mode</label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { value: 'single', label: 'Single Unit',  desc: 'Full amount to one tenant' },
                    { value: 'split',  label: 'Split',        desc: `÷ ${chargeExpense.property_id ? 'all units' : 'N/A'} equally` },
                    { value: 'each',   label: 'Each Unit',    desc: 'Full amount per unit' },
                  ] as const).map(opt => (
                    <button key={opt.value} onClick={() => setChargeMode(opt.value)}
                      disabled={opt.value === 'single' && !chargeExpense.unit_id}
                      className={`p-3 rounded-xl border text-left transition disabled:opacity-40
                        ${chargeMode === opt.value
                          ? 'border-teal-500 bg-teal-50'
                          : 'border-gray-200 hover:border-gray-300'}`}>
                      <p className={`text-xs font-bold ${chargeMode === opt.value ? 'text-teal-700' : 'text-gray-700'}`}>{opt.label}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{opt.desc}</p>
                    </button>
                  ))}
                </div>
                {chargeMode === 'single' && !chargeExpense.unit_id && (
                  <p className="text-xs text-red-500 mt-1">Expense must have a unit set for single-unit charging.</p>
                )}
                {(chargeMode === 'split' || chargeMode === 'each') && !chargeExpense.property_id && (
                  <p className="text-xs text-red-500 mt-1">Expense must have a property set for building-wide charging.</p>
                )}
              </div>

              {/* Preview */}
              {chargeMode === 'split' && chargeExpense.property_id && (
                <div className="bg-teal-50 border border-teal-100 rounded-xl p-3 text-xs text-teal-800">
                  <strong>{KES(chargeExpense.amount)}</strong> will be divided equally among all occupied units in <strong>{chargeExpense.property_name}</strong>.
                  Each tenant pays their share.
                </div>
              )}
              {chargeMode === 'each' && chargeExpense.property_id && (
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
                  <strong>{KES(chargeExpense.amount)}</strong> will be charged to <em>each</em> occupied unit in <strong>{chargeExpense.property_name}</strong>.
                </div>
              )}

              {/* Month */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Add to Rent Bill for Month</label>
                <input type="month" value={chargeMonth.slice(0, 7)}
                  onChange={e => setChargeMonth(e.target.value + '-01')}
                  className={inputCls} />
                <p className="text-xs text-gray-400 mt-1">The charge will be added to the tenant's existing rent bill for this month. They pay it all in one transaction.</p>
              </div>

              {/* Optional description override */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Bill Description (optional)</label>
                <input value={chargeDesc} onChange={e => setChargeDesc(e.target.value)}
                  placeholder={`${chargeExpense.category} charge — ${chargeExpense.description}`}
                  className={inputCls} />
              </div>

              {/* Result */}
              {chargeResult && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-800 flex items-start gap-2">
                  <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>{chargeResult.message}</span>
                </div>
              )}
              {chargeError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{chargeError}</p>}
            </div>

            <div className="px-6 pb-6 flex justify-end gap-3">
              <button onClick={() => setChargeExpense(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition">
                {chargeResult ? 'Close' : 'Cancel'}
              </button>
              {!chargeResult && (
                <button onClick={submitCharge} disabled={charging
                  || (chargeMode === 'single' && !chargeExpense.unit_id)
                  || ((chargeMode === 'split' || chargeMode === 'each') && !chargeExpense.property_id)}
                  className="px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition"
                  style={{ background:'linear-gradient(135deg,#0d9f9f,#076666)' }}>
                  {charging ? 'Charging…' : 'Charge to Tenant(s)'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}