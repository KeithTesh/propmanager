// web/src/pages/maintenance/MaintenancePage.tsx

import { useToast } from '../../components/ui/Toast';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, getApiErrorMessage } from '../../lib/api';

interface MaintenanceRequest {
  id: string; title: string; description: string | null;
  priority: 'low'|'medium'|'high'|'urgent'; status: string; category: string;
  property_name: string; unit_number: string | null;
  reported_by_name: string | null; assigned_to_name: string | null;
  reported_at: string; resolved_at: string | null; resolution_notes: string | null;
}

interface Property { id: string; name: string; }

const PRIORITY_STYLE: Record<string, string> = {
  urgent: 'bg-red-100 text-red-700',
  high:   'bg-orange-100 text-orange-700',
  medium: 'bg-amber-50 text-amber-700',
  low:    'bg-gray-100 text-gray-500',
};
const PRIORITY_DOT: Record<string, string> = {
  urgent: '#ef4444', high: '#f97316', medium: '#f59e0b', low: '#9ca3af',
};
const STATUS_STYLE: Record<string, string> = {
  open:         'bg-blue-50 text-blue-600',
  acknowledged: 'bg-purple-50 text-purple-600',
  in_progress:  'bg-amber-50 text-amber-700',
  resolved:     'bg-emerald-50 text-emerald-700',
  closed:       'bg-gray-100 text-gray-400',
};
const CATEGORIES = ['plumbing','electrical','structural','cleaning','appliance','security','other'];
const PRIORITIES = ['low','medium','high','urgent'] as const;
const DATE = (d: string) => new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
const inputCls = "w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 transition";

function CreateModal({ properties, onClose, onSaved }: {
  properties: Property[]; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    propertyId: properties[0]?.id ?? '',
    unitId: '', title: '', description: '',
    priority: 'medium' as typeof PRIORITIES[number],
    category: 'other',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Fetch units for selected property
  const { data: units } = useQuery({
    queryKey: ['units-for-maintenance', form.propertyId],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { units: {id:string;unit_number:string}[] } }>(`/units?propertyId=${form.propertyId}`);
      return res.data.data.units;
    },
    enabled: !!form.propertyId,
  });

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  async function submit() {
    if (!form.title.trim()) { setError('Title is required'); return; }
    setError(''); setLoading(true);
    try {
      await apiClient.post('/maintenance', {
        propertyId:  form.propertyId,
        unitId:      form.unitId || null,
        title:       form.title,
        description: form.description || null,
        priority:    form.priority,
        category:    form.category,
      });
      onSaved();
    } catch (e) { setError(getApiErrorMessage(e)); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Report Issue</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="p-6 space-y-4 max-h-[30rem] overflow-y-auto">
          {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Property *</label>
              <select value={form.propertyId} onChange={e => set('propertyId', e.target.value)} className={inputCls + ' bg-white'}>
                {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Unit</label>
              <select value={form.unitId} onChange={e => set('unitId', e.target.value)} className={inputCls + ' bg-white'}>
                <option value="">— whole property —</option>
                {units?.map(u => <option key={u.id} value={u.id}>{u.unit_number}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Title *</label>
            <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Leaking pipe in bathroom" className={inputCls} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3}
              placeholder="Describe the issue in detail…" className={inputCls + ' resize-none'} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Priority</label>
              <div className="grid grid-cols-2 gap-1.5">
                {PRIORITIES.map(p => (
                  <button key={p} onClick={() => set('priority', p)}
                    className={`py-1.5 rounded-lg text-xs font-semibold capitalize border-2 transition
                      ${form.priority === p ? 'border-current' : 'border-gray-200 text-gray-500'}`}
                    style={form.priority === p ? { borderColor: PRIORITY_DOT[p], color: PRIORITY_DOT[p], background: PRIORITY_DOT[p] + '18' } : {}}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Category</label>
              <select value={form.category} onChange={e => set('category', e.target.value)} className={inputCls + ' bg-white capitalize'}>
                {CATEGORIES.map(c => <option key={c} value={c} className="capitalize">{c}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition">Cancel</button>
          <button onClick={submit} disabled={loading}
            className="px-5 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60 flex items-center gap-2 transition"
            style={{ background: '#0d9f9f' }}>
            {loading && <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
            Submit Issue
          </button>
        </div>
      </div>
    </div>
  );
}

function RequestCard({ req, onUpdate }: { req: MaintenanceRequest; onUpdate: () => void }) {
  const { toast } = useToast();
  const [updating, setUpdating] = useState(false);
  const [notes, setNotes] = useState(req.resolution_notes ?? '');

  async function updateStatus(status: string) {
    setUpdating(true);
    try {
      await apiClient.patch(`/maintenance/${req.id}`, { status, resolutionNotes: notes || null });
      onUpdate();
    } catch (e) { toast(getApiErrorMessage(e), 'error'); }
    finally { setUpdating(false); }
  }

  const nextActions: Record<string, { label: string; status: string; color: string }[]> = {
    open:         [{ label: 'Acknowledge', status: 'acknowledged', color: '#7c3aed' }],
    acknowledged: [{ label: 'Start Work',  status: 'in_progress',  color: '#d97706' }],
    in_progress:  [{ label: 'Mark Resolved', status: 'resolved',   color: '#059669' }],
    resolved:     [{ label: 'Close',        status: 'closed',       color: '#6b7280' }],
    closed:       [],
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-all">
      <div className="h-1" style={{ background: PRIORITY_DOT[req.priority] }} />
      <div className="p-5">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 leading-tight">{req.title}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {req.property_name}{req.unit_number ? ` · Unit ${req.unit_number}` : ''}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${PRIORITY_STYLE[req.priority]}`}>
              {req.priority}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_STYLE[req.status]}`}>
              {req.status.replace('_',' ')}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-gray-400 mb-3">
          <span className="capitalize">{req.category}</span>
          <span>·</span>
          <span>{DATE(req.reported_at)}</span>
          {req.reported_by_name && <><span>·</span><span>by {req.reported_by_name}</span></>}
        </div>

        {req.description && (
          <p className="text-sm text-gray-600 line-clamp-2 mb-3">{req.description}</p>
        )}

        {req.assigned_to_name && (
          <p className="text-xs text-gray-500 mb-3">
            👷 Assigned to <span className="font-medium">{req.assigned_to_name}</span>
          </p>
        )}

        {/* Actions */}
        {(nextActions[req.status] ?? []).length > 0 && (
          <div>
            {(req.status === 'in_progress' || req.status === 'acknowledged') && (
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                placeholder="Resolution notes (optional)…"
                className="w-full mb-2 px-3 py-2 rounded-lg border border-gray-200 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-teal-500" />
            )}
            <div className="flex gap-2">
              {(nextActions[req.status] ?? []).map(action => (
                <button key={action.status} onClick={() => updateStatus(action.status)} disabled={updating}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-60 transition"
                  style={{ background: action.color }}>
                  {updating ? '…' : action.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {req.resolved_at && req.resolution_notes && (
          <div className="mt-2 p-2.5 rounded-lg bg-emerald-50 border border-emerald-100">
            <p className="text-xs text-emerald-700">✓ {req.resolution_notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MaintenancePage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [filterStatus,   setFilterStatus]   = useState('');
  const [filterPriority, setFilterPriority] = useState('');

  const { data: requests, isLoading } = useQuery({
    queryKey: ['maintenance', filterStatus, filterPriority],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterStatus)   params.set('status',   filterStatus);
      if (filterPriority) params.set('priority', filterPriority);
      const res = await apiClient.get<{ data: { requests: MaintenanceRequest[] } }>(`/maintenance?${params}`);
      return res.data.data.requests;
    },
  });

  const { data: summary } = useQuery({
    queryKey: ['maintenance-summary'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { summary: { open_count: string; urgent_count: string; unacknowledged: string } } }>('/maintenance/summary');
      return res.data.data.summary;
    },
  });

  const { data: properties } = useQuery({
    queryKey: ['properties-list'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { properties: Property[] } }>('/properties');
      return res.data.data.properties;
    },
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ['maintenance'] });
    qc.invalidateQueries({ queryKey: ['maintenance-summary'] });
    setShowCreate(false);
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Maintenance</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track and resolve property issues</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition"
          style={{ background: 'linear-gradient(135deg,#0d9f9f,#076666)' }}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
          Report Issue
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Open Issues',    value: summary?.open_count      ?? '…', color: '#3b82f6' },
          { label: 'Urgent',         value: summary?.urgent_count    ?? '…', color: '#ef4444' },
          { label: 'Unacknowledged', value: summary?.unacknowledged  ?? '…', color: '#f59e0b' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{s.label}</p>
            <p className="text-2xl font-bold mt-1" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-6 flex-wrap">
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500">
          <option value="">All statuses</option>
          {['open','acknowledged','in_progress','resolved','closed'].map(s => (
            <option key={s} value={s} className="capitalize">{s.replace('_',' ')}</option>
          ))}
        </select>
        <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500">
          <option value="">All priorities</option>
          {PRIORITIES.map(p => <option key={p} value={p} className="capitalize">{p}</option>)}
        </select>
        {(filterStatus || filterPriority) && (
          <button onClick={() => { setFilterStatus(''); setFilterPriority(''); }}
            className="px-3 py-2 rounded-lg text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition">
            Clear filters
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor:'#0d9f9f', borderTopColor:'transparent' }} />
        </div>
      ) : !requests?.length ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'linear-gradient(135deg,#e6fafa,#b2eded)' }}>
            <svg className="w-8 h-8" style={{ color:'#0d9f9f' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-gray-900 mb-1">No open issues</h3>
          <p className="text-sm text-gray-500">All properties are in good shape 🎉</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {requests.map(r => (
            <RequestCard key={r.id} req={r} onUpdate={refresh} />
          ))}
        </div>
      )}

      {showCreate && properties && (
        <CreateModal properties={properties} onClose={() => setShowCreate(false)} onSaved={refresh} />
      )}
    </div>
  );
}