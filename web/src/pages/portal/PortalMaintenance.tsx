// web/src/pages/portal/PortalMaintenance.tsx

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';

function fmt(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_CHIP: Record<string, string> = {
  open:        'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  resolved:    'bg-green-100 text-green-700',
  closed:      'bg-gray-100 text-gray-500',
};

const PRIORITY_CHIP: Record<string, string> = {
  low:    'bg-gray-100 text-gray-500',
  medium: 'bg-blue-100 text-blue-600',
  high:   'bg-orange-100 text-orange-600',
  urgent: 'bg-red-100 text-red-600',
};

const CATEGORIES = [
  'Plumbing', 'Electrical', 'Carpentry', 'Painting', 'Roofing',
  'Security', 'Cleaning', 'Pest Control', 'HVAC / AC', 'Other',
];

export default function PortalMaintenance() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', category: '', priority: 'medium' as const });
  const [submitted, setSubmitted] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['portal-maintenance'],
    queryFn: () => apiClient.get('/portal/maintenance').then(r => r.data.data.requests),
  });

  const submit = useMutation({
    mutationFn: () => apiClient.post('/portal/maintenance', form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-maintenance'] });
      setForm({ title: '', description: '', category: '', priority: 'medium' });
      setShowForm(false);
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 4000);
    },
  });

  const requests: any[] = data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Maintenance</h1>
        <button onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-white transition"
          style={{ background: '#0d9f9f' }}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Request
        </button>
      </div>

      {submitted && (
        <div className="bg-green-50 border border-green-100 rounded-xl p-3 text-sm text-green-700 font-medium">
          ✓ Request submitted. Your property manager will be in touch.
        </div>
      )}

      {/* Submit form */}
      {showForm && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4">
          <p className="text-sm font-bold text-gray-800">Report an Issue</p>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">
              Title <span className="text-red-400">*</span>
            </label>
            <input
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Leaking tap in kitchen"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">
              Description <span className="text-red-400">*</span>
            </label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={3}
              placeholder="Describe the issue in detail — when it started, how severe, etc."
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Category</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500">
                <option value="">Select…</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Priority</label>
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value as any }))}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={() => setShowForm(false)}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
            <button
              disabled={!form.title || !form.description || submit.isPending}
              onClick={() => submit.mutate()}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition"
              style={{ background: '#0d9f9f' }}>
              {submit.isPending ? 'Submitting…' : 'Submit Request'}
            </button>
          </div>
          {submit.isError && (
            <p className="text-xs text-red-500">Failed to submit. Please try again.</p>
          )}
        </div>
      )}

      {/* Requests list */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="w-7 h-7 border-2 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: '#0d9f9f', borderTopColor: 'transparent' }} />
        </div>
      ) : requests.length === 0 ? (
        <div className="text-center py-12 text-sm text-gray-400">
          No maintenance requests yet. Tap "New Request" to report an issue.
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((r: any) => (
            <div key={r.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900">{r.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{r.unit_number} · {r.property_name}</p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_CHIP[r.status] ?? 'bg-gray-100 text-gray-500'}`}>
                    {r.status.replace('_', ' ').replace(/^\w/, (c: string) => c.toUpperCase())}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${PRIORITY_CHIP[r.priority] ?? 'bg-gray-100 text-gray-500'}`}>
                    {r.priority.charAt(0).toUpperCase() + r.priority.slice(1)}
                  </span>
                </div>
              </div>
              {r.description && (
                <p className="text-xs text-gray-500 mt-2 line-clamp-2">{r.description}</p>
              )}
              <div className="flex items-center justify-between mt-3 text-xs text-gray-400">
                <span>Reported {fmt(r.reported_at)}</span>
                {r.resolved_at && <span className="text-green-600">Resolved {fmt(r.resolved_at)}</span>}
                {r.category && <span className="bg-gray-100 px-2 py-0.5 rounded-full">{r.category}</span>}
              </div>
              {r.notes && (
                <div className="mt-2 p-2 bg-teal-50 rounded-lg text-xs text-teal-700">
                  <span className="font-semibold">Note from manager:</span> {r.notes}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}