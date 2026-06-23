// web/src/pages/audit/AuditPage.tsx

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';

interface AuditLog {
  id: string;
  table_name: string;
  record_id: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE' | 'SOFT_DELETE';
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  changed_fields: string[] | null;
  ip_address: string | null;
  created_at: string;
  event_label: string;
}

interface Actor { actor_id: string; full_name: string; }

const ACTION_STYLE: Record<string, string> = {
  INSERT:      'bg-emerald-50 text-emerald-700 border-emerald-100',
  UPDATE:      'bg-blue-50 text-blue-700 border-blue-100',
  DELETE:      'bg-red-50 text-red-700 border-red-100',
  SOFT_DELETE: 'bg-red-50 text-red-700 border-red-100',
};

const TABLE_COLOR: Record<string, string> = {
  payments:      '#10b981',
  monthly_bills: '#3b82f6',
  expenses:      '#f59e0b',
  leases:        '#8b5cf6',
  tenants:       '#0d9f9f',
  units:         '#6b7280',
};

const TABLE_TABLES = [
  { value: '', label: 'All tables' },
  { value: 'payments',      label: 'Payments' },
  { value: 'monthly_bills', label: 'Bills' },
  { value: 'expenses',      label: 'Expenses' },
  { value: 'leases',        label: 'Leases' },
  { value: 'tenants',       label: 'Tenants' },
];

const ACTIONS = [
  { value: '',            label: 'All actions' },
  { value: 'INSERT',      label: 'Created' },
  { value: 'UPDATE',      label: 'Updated' },
  { value: 'DELETE',      label: 'Deleted' },
];

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Platform',
  owner:       'Admin',
  manager:     'Manager',
  finance:     'Accountant',
  caretaker:   'Caretaker',
  tenant:      'Tenant',
};

function fmtTs(ts: string) {
  const d = new Date(ts);
  return d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })
    + ' · '
    + d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
}

function timeAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function DiffViewer({ log }: { log: AuditLog }) {
  const [open, setOpen] = useState(false);
  const hasDetail = log.old_values || log.new_values;
  if (!hasDetail) return null;

  // For INSERTs show all new_values keys; for UPDATE/DELETE use changed_fields then fall back
  const fields = log.action === 'INSERT'
    ? Object.keys(log.new_values ?? {})
    : (log.changed_fields ?? [
        ...Object.keys(log.old_values ?? {}),
        ...Object.keys(log.new_values ?? {}),
      ].filter((v, i, a) => a.indexOf(v) === i));

  const fmt = (v: unknown) => {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'number' && String(v).length > 6) return v.toLocaleString('en-KE');
    return String(v);
  };

  return (
    <div className="mt-1">
      <button onClick={() => setOpen(v => !v)}
        className="text-xs text-gray-400 hover:text-teal-600 transition underline underline-offset-2">
        {open ? 'Hide details' : 'Show details'}
      </button>
      {open && (
        <div className="mt-2 rounded-xl border border-gray-100 overflow-hidden text-xs font-mono">
          {fields.map(field => {
            const oldVal = log.old_values?.[field];
            const newVal = log.new_values?.[field];
            const changed = log.action === 'INSERT' || JSON.stringify(oldVal) !== JSON.stringify(newVal);
            return (
              <div key={field} className={`px-3 py-1.5 flex items-center gap-2 ${changed && log.action !== 'INSERT' ? 'bg-amber-50' : 'bg-gray-50'} border-b border-gray-100 last:border-0`}>
                <span className="text-gray-400 w-32 shrink-0">{field.replace(/_/g, ' ')}</span>
                {log.action !== 'INSERT' && oldVal !== undefined && (
                  <span className="line-through text-red-400">{fmt(oldVal)}</span>
                )}
                {log.action !== 'INSERT' && oldVal !== undefined && newVal !== undefined && (
                  <span className="text-gray-300 mx-1">→</span>
                )}
                {newVal !== undefined && (
                  <span className={log.action === 'INSERT' ? 'text-gray-800 font-medium' : changed ? 'text-emerald-700 font-semibold' : 'text-gray-600'}>
                    {fmt(newVal)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const PAGE_SIZE = 50;

export default function AuditPage() {
  const [filterTable,  setFilterTable]  = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterActor,  setFilterActor]  = useState('');
  const [filterFrom,   setFilterFrom]   = useState('');
  const [filterTo,     setFilterTo]     = useState('');
  const [page,         setPage]         = useState(0);

  const params = new URLSearchParams();
  if (filterTable)  params.set('table',  filterTable);
  if (filterAction) params.set('action', filterAction);
  if (filterActor)  params.set('actor',  filterActor);
  if (filterFrom)   params.set('from',   filterFrom + 'T00:00:00Z');
  if (filterTo)     params.set('to',     filterTo   + 'T23:59:59Z');
  params.set('limit',  String(PAGE_SIZE));
  params.set('offset', String(page * PAGE_SIZE));

  const { data, isLoading } = useQuery({
    queryKey: ['audit', filterTable, filterAction, filterActor, filterFrom, filterTo, page],
    queryFn: async () => {
      const r = await apiClient.get<{ data: { logs: AuditLog[]; total: number } }>(`/audit?${params}`);
      return r.data.data;
    },
    keepPreviousData: true,
  } as any);

  const { data: actorsData } = useQuery({
    queryKey: ['audit-actors'],
    queryFn: async () => {
      const r = await apiClient.get<{ data: { actors: Actor[] } }>('/audit/actors');
      return r.data.data.actors;
    },
  });

  const logs  = (data as any)?.logs  ?? [];
  const total = (data as any)?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  function clearFilters() {
    setFilterTable(''); setFilterAction(''); setFilterActor('');
    setFilterFrom(''); setFilterTo(''); setPage(0);
  }

  const hasFilters = filterTable || filterAction || filterActor || filterFrom || filterTo;

  return (
    <div className="p-6 lg:p-8 ">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Audit Trail</h1>
        <p className="text-sm text-gray-500 mt-0.5">Immutable log of all financial actions</p>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
        {TABLE_TABLES.slice(1).map(t => (
          <button key={t.value} onClick={() => { setFilterTable(filterTable === t.value ? '' : t.value); setPage(0); }}
            className={`rounded-xl border px-3 py-3 text-left transition
              ${filterTable === t.value ? 'border-teal-400 bg-teal-50' : 'border-gray-100 bg-white hover:border-gray-200'}`}>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: TABLE_COLOR[t.value] ?? '#6b7280' }} />
              <span className="text-xs font-semibold text-gray-600">{t.label}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={filterAction} onChange={e => { setFilterAction(e.target.value); setPage(0); }}
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white">
          {ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
        <select value={filterActor} onChange={e => { setFilterActor(e.target.value); setPage(0); }}
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white">
          <option value="">All users</option>
          <option value="system">System / Cron</option>
          {(actorsData ?? []).map((a: Actor) => (
            <option key={a.actor_id} value={a.actor_id}>{a.full_name}</option>
          ))}
        </select>
        <input type="date" value={filterFrom} onChange={e => { setFilterFrom(e.target.value); setPage(0); }}
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
        <span className="text-gray-400 text-sm">to</span>
        <input type="date" value={filterTo} onChange={e => { setFilterTo(e.target.value); setPage(0); }}
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
        {hasFilters && (
          <button onClick={clearFilters}
            className="px-3 py-2 rounded-lg text-xs font-medium text-gray-500 hover:text-red-500 border border-gray-200 bg-white transition">
            Clear
          </button>
        )}
        <span className="ml-auto text-xs text-gray-400">{total.toLocaleString()} events</span>
      </div>

      {/* Log list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor:'#0d9f9f', borderTopColor:'transparent' }} />
        </div>
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'linear-gradient(135deg,#e6fafa,#b2eded)' }}>
            <svg className="w-8 h-8" style={{ color:'#0d9f9f' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-gray-900 mb-1">No audit events yet</h3>
          <p className="text-sm text-gray-500">Events will appear here as your team performs actions.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {logs.map((log: AuditLog, i: number) => (
            <div key={log.id}
              className={`px-5 py-4 flex gap-4 ${i < logs.length - 1 ? 'border-b border-gray-50' : ''} hover:bg-gray-50 transition`}>

              {/* Left: colour dot + timeline line */}
              <div className="flex flex-col items-center pt-1 shrink-0">
                <div className="w-3 h-3 rounded-full border-2 border-white shadow-sm"
                  style={{ background: TABLE_COLOR[log.table_name] ?? '#6b7280' }} />
                {i < logs.length - 1 && <div className="w-px flex-1 mt-1 bg-gray-100" />}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    {/* Event label */}
                    <p className="text-sm font-semibold text-gray-900">{log.event_label}</p>

                    {/* Inline key values for common events */}
                    {log.new_values && (
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        {log.table_name === 'payments' && log.action === 'INSERT' && (<>
                          {log.new_values.amount !== undefined && (
                            <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-full font-semibold">
                              KES {Number(log.new_values.amount).toLocaleString('en-KE')}
                            </span>
                          )}
                          {log.new_values.channel && (
                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium capitalize">
                              {String(log.new_values.channel).replace(/_/g, ' ')}
                            </span>
                          )}
                        </>)}
                        {log.table_name === 'monthly_bills' && log.new_values.status === 'waived' && (
                          <span className="text-xs bg-orange-50 text-orange-700 border border-orange-100 px-2 py-0.5 rounded-full font-medium">
                            {String(log.new_values.waive_reason ?? 'No reason given')}
                          </span>
                        )}
                        {log.table_name === 'expenses' && log.new_values.amount !== undefined && (
                          <span className="text-xs bg-amber-50 text-amber-700 border border-amber-100 px-2 py-0.5 rounded-full font-semibold">
                            KES {Number(log.new_values.amount).toLocaleString('en-KE')}
                          </span>
                        )}
                        {log.table_name === 'leases' && Boolean(log.new_values.status) && (
                          <span className="text-xs bg-purple-50 text-purple-700 border border-purple-100 px-2 py-0.5 rounded-full font-medium capitalize">
                            {String(log.new_values.status)}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Meta row */}
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      {/* Action badge */}
                      <span className={`px-1.5 py-0.5 rounded text-xs font-bold border uppercase tracking-wide ${ACTION_STYLE[log.action] ?? ''}`}>
                        {log.action}
                      </span>
                      {/* Table */}
                      <span className="text-xs text-gray-400 font-mono"
                        style={{ color: TABLE_COLOR[log.table_name] ?? '#6b7280' }}>
                        {log.table_name.replace(/_/g, ' ')}
                      </span>
                      {/* Actor */}
                      <span className="text-xs text-gray-500">
                        {log.actor_name
                          ? <>by <span className="font-medium text-gray-700">{log.actor_name}</span>
                            {log.actor_role && <span className="text-gray-400"> ({ROLE_LABEL[log.actor_role] ?? log.actor_role})</span>}
                          </>
                          : <span className="text-gray-400 italic">system / cron</span>
                        }
                      </span>
                      {/* IP */}
                      {log.ip_address && (
                        <span className="text-xs text-gray-300 font-mono">{log.ip_address}</span>
                      )}
                    </div>

                    {/* Diff viewer */}
                    <DiffViewer log={log} />
                  </div>

                  {/* Timestamp */}
                  <div className="text-right shrink-0">
                    <p className="text-xs font-medium text-gray-500">{timeAgo(log.created_at)}</p>
                    <p className="text-xs text-gray-300 mt-0.5">{fmtTs(log.created_at)}</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-gray-400">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => p - 1)} disabled={page === 0}
              className="px-3 py-1.5 rounded-lg text-sm border border-gray-200 bg-white disabled:opacity-40 hover:bg-gray-50 transition">
              ← Prev
            </button>
            <span className="text-xs text-gray-500">Page {page + 1} of {totalPages}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}
              className="px-3 py-1.5 rounded-lg text-sm border border-gray-200 bg-white disabled:opacity-40 hover:bg-gray-50 transition">
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}