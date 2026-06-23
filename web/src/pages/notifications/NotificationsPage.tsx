// web/src/pages/notifications/NotificationsPage.tsx

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, getApiErrorMessage } from '../../lib/api';
import { useToast } from '../../components/ui/Toast';
import { useConfirm } from '../../components/ui/ConfirmDialog';

interface Notification {
  id: string; channel: string; recipient: string; body: string;
  status: string; tenant_name: string | null; unit_number: string | null;
  property_name: string | null; at_error: string | null;
  sent_at: string | null; created_at: string; attempt_count: number;
  archived_at: string | null;
}

interface InAppAlert {
  id: string; title: string; body: string; type: string;
  is_read: boolean; read_at: string | null; created_at: string;
  action_url: string | null;
  link: string | null;
}

const DATE = (d: string) => new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const SMS_STATUS: Record<string, { cls: string; label: string }> = {
  sent:      { cls: 'bg-emerald-50 text-emerald-700', label: 'Sent' },
  failed:    { cls: 'bg-red-50 text-red-600',         label: 'Failed' },
  queued:    { cls: 'bg-blue-50 text-blue-600',       label: 'Queued' },
  cancelled: { cls: 'bg-gray-100 text-gray-500',      label: 'Cancelled' },
};

const ALERT_ICON: Record<string, string> = {
  payment_received: '💰', payment_reminder: '📅', maintenance: '🔧',
  lease: '📋', general: 'ℹ️',
};

type Tab = 'sms' | 'inapp' | 'test';

export default function NotificationsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const [tab, setTab] = useState<Tab>('sms');

  // ── SMS Log state ──
  const [blasting, setBlasting]     = useState(false);
  const [blastResult, setBlastResult] = useState<{ sent: number; failed: number; skipped: number } | null>(null);
  const [retrying, setRetrying]     = useState<string | null>(null);
  const [smsSearch, setSmsSearch]   = useState('');
  const [smsFilter, setSmsFilter]   = useState<'all'|'sent'|'failed'|'queued'>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [archiving, setArchiving]       = useState(false);

  // ── Test state ──
  const [testPhone, setTestPhone]   = useState('');
  const [testMsg, setTestMsg]       = useState('PropManager test SMS — your Africa\'s Talking integration is working! ✓');
  const [testing, setTesting]       = useState(false);
  const [testResult, setTestResult] = useState<{ sent: boolean; error?: string; environment?: string } | null>(null);

  // ── Queries ──
  const { data: smsData, isLoading: smsLoading } = useQuery({
    queryKey: ['notifications', showArchived],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { notifications: Notification[] } }>(`/notifications${showArchived ? '?archived=true' : ''}`);
      return res.data.data.notifications;
    },
  });

  const { data: inAppData, isLoading: inAppLoading } = useQuery({
    queryKey: ['inapp-alerts'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { items: InAppAlert[]; unread: number } }>('/notifications/in-app?limit=50');
      return res.data.data;
    },
    enabled: tab === 'inapp',
  });

  // ── SMS actions ──
  function notifyBlastDone(sent: number, failed: number) {
    if (sent === 0 && failed === 0) {
      toast('No unpaid bills found — nothing was sent', 'info');
    } else if (failed > 0) {
      toast(`${sent} sent, ${failed} failed — check the log for details`, 'warning');
    } else {
      toast(`${sent} reminder${sent !== 1 ? 's' : ''} sent successfully!`, 'success');
    }
  }

  async function blast(force = false) {
    if (!force) {
      if (!await confirm({ title: 'Send Monthly Reminders', message: 'Send rent reminder SMS to all tenants with unpaid bills?', confirmLabel: 'Send', variant: 'info' })) return;
    }
    setBlasting(true); setBlastResult(null);
    toast('Sending reminders to all tenants with unpaid bills…', 'info');
    try {
      const res = await apiClient.post<{ data: {
        sent?: number; failed?: number; skipped?: number;
        warn?: boolean; recentCount?: number; message?: string;
      } }>('/notifications/blast', { force });

      const d = res.data.data;

      if (d.warn) {
        // Keep spinner active while user reads the warning dialog
        const proceed = await confirm({
          title: 'Already sent recently',
          message: d.message ?? `${d.recentCount} reminder(s) were sent in the last 24 hours. Send again anyway?`,
          confirmLabel: 'Send Anyway',
          variant: 'warning',
        });
        if (!proceed) return;
        // Force-send without recursion to avoid state race conditions
        const res2 = await apiClient.post<{ data: { sent: number; failed: number; skipped: number } }>('/notifications/blast', { force: true });
        const d2 = res2.data.data;
        setBlastResult(d2);
        qc.invalidateQueries({ queryKey: ['notifications'] });
        notifyBlastDone(d2.sent ?? 0, d2.failed ?? 0);
        return;
      }

      const result = d as { sent: number; failed: number; skipped: number };
      setBlastResult(result);
      qc.invalidateQueries({ queryKey: ['notifications'] });
      notifyBlastDone(result.sent ?? 0, result.failed ?? 0);
    } catch (e) { toast(getApiErrorMessage(e), 'error'); }
    finally { setBlasting(false); }
  }

  async function retry(id: string) {
    setRetrying(id);
    try {
      await apiClient.post(`/notifications/${id}/retry`, {});
      qc.invalidateQueries({ queryKey: ['notifications'] });
      toast('Retried successfully', 'success');
    } catch (e) { toast(getApiErrorMessage(e), 'error'); }
    finally { setRetrying(null); }
  }

  async function archiveOne(id: string) {
    try {
      await apiClient.post(`/notifications/${id}/archive`, {});
      qc.invalidateQueries({ queryKey: ['notifications'] });
    } catch (e) { toast(getApiErrorMessage(e), 'error'); }
  }

  async function archiveAll() {
    if (!await confirm({ title: 'Archive All', message: 'Archive all notifications? They will be hidden from the log but kept for 30 days.', confirmLabel: 'Archive All', variant: 'warning' })) return;
    setArchiving(true);
    try {
      const res = await apiClient.post<{ data: { archived: number } }>('/notifications/archive-all', {});
      toast(`${res.data.data.archived} notifications archived`, 'success');
      qc.invalidateQueries({ queryKey: ['notifications'] });
    } catch (e) { toast(getApiErrorMessage(e), 'error'); }
    finally { setArchiving(false); }
  }

  async function retryAllFailed() {
    const failed = (smsData ?? []).filter(n => n.status === 'failed');
    if (!await confirm({ title: `Retry ${failed.length} failed`, message: `Retry all ${failed.length} failed notifications?`, confirmLabel: 'Retry All', variant: 'warning' })) return;
    for (const n of failed) await retry(n.id);
  }

  // ── In-App actions ──
  async function markAllRead() {
    try {
      await apiClient.post('/notifications/in-app/mark-read', {});
      qc.invalidateQueries({ queryKey: ['inapp-alerts'] });
    } catch (e) { toast(getApiErrorMessage(e), 'error'); }
  }

  // ── Test action ──
  async function sendTest() {
    if (!testPhone.trim()) { toast('Enter a phone number', 'warning'); return; }
    setTesting(true); setTestResult(null);
    try {
      const res = await apiClient.post<{ data: { sent: boolean; error?: string; environment?: string } }>('/notifications/test-sms', { phone: testPhone.trim(), message: testMsg });
      setTestResult(res.data.data);
      if (res.data.data.sent) {
        toast('Test SMS sent!', 'success');
        qc.invalidateQueries({ queryKey: ['notifications'] });
      } else {
        toast(res.data.data.error ?? 'Send failed', 'error');
      }
    } catch (e) { toast(getApiErrorMessage(e), 'error'); }
    finally { setTesting(false); }
  }

  // ── Filtered SMS ──
  const allSms = smsData ?? [];
  const filtered = allSms
    .filter(n => smsFilter === 'all' || n.status === smsFilter)
    .filter(n => !smsSearch || n.tenant_name?.toLowerCase().includes(smsSearch.toLowerCase()) || n.recipient.includes(smsSearch) || n.property_name?.toLowerCase().includes(smsSearch.toLowerCase()));

  const sent   = allSms.filter(n => n.status === 'sent').length;
  const failed = allSms.filter(n => n.status === 'failed').length;
  const queued = allSms.filter(n => n.status === 'queued').length;
  const unread = inAppData?.unread ?? 0;

  const C = 'bg-white rounded-2xl border border-gray-100 shadow-sm';

  return (
    <div className="p-6 lg:p-8">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
          <p className="text-sm text-gray-500 mt-0.5">SMS reminders, in-app alerts and testing</p>
        </div>
        {tab === 'sms' && (
          <button onClick={() => blast()} disabled={blasting}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60 disabled:cursor-not-allowed transition"
            style={{ background: 'linear-gradient(135deg,#0d9f9f,#076666)' }}
            title={blasting ? 'Sending in progress…' : 'Send SMS reminders to all tenants with unpaid bills'}>
            {blasting
              ? <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
              : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"/></svg>}
            {blasting ? 'Sending…' : 'Send Monthly Reminders'}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit">
        {([
          { k: 'sms',   label: '📱 SMS Log' },
          { k: 'inapp', label: `🔔 In-App Alerts${unread > 0 ? ` (${unread})` : ''}` },
          { k: 'test',  label: '🧪 Test' },
        ] as const).map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition
              ${tab === t.k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── SMS LOG TAB ── */}
      {tab === 'sms' && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-4 gap-4 mb-5">
            {[
              { label: 'Sent',   value: sent,          color: '#10b981' },
              { label: 'Failed', value: failed,        color: '#ef4444' },
              { label: 'Queued', value: queued,        color: '#3b82f6' },
              { label: 'Total',  value: allSms.length, color: '#6b7280' },
            ].map(s => (
              <div key={s.label} className={`${C} p-4`}>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{s.label}</p>
                <p className="text-2xl font-bold mt-1" style={{ color: s.color }}>{s.value}</p>
              </div>
            ))}
          </div>

          {blastResult && (
            <div className="mb-4 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-center justify-between">
              <span>✅ Blast complete — <strong>{blastResult.sent}</strong> sent · <strong>{blastResult.failed}</strong> failed · <strong>{blastResult.skipped}</strong> skipped (no phone / notifications off)</span>
              <button onClick={() => setBlastResult(null)} className="text-emerald-600 hover:text-emerald-800 ml-4">✕</button>
            </div>
          )}

          {/* Filters */}
          <div className="flex gap-3 mb-4">
            <input value={smsSearch} onChange={e => setSmsSearch(e.target.value)}
              placeholder="Search tenant, phone, property…"
              className="flex-1 px-4 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
              {(['all','sent','failed','queued'] as const).map(f => (
                <button key={f} onClick={() => setSmsFilter(f)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition
                    ${smsFilter === f ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  {f} {f !== 'all' && `(${allSms.filter(n => n.status === f).length})`}
                </button>
              ))}
            </div>
            {failed > 0 && !showArchived && (
              <button onClick={retryAllFailed}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold text-red-600 border border-red-200 hover:bg-red-50 transition whitespace-nowrap">
                ↺ Retry all failed ({failed})
              </button>
            )}
            {!showArchived && allSms.length > 0 && (
              <button onClick={archiveAll} disabled={archiving}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 transition whitespace-nowrap disabled:opacity-50">
                {archiving ? 'Archiving…' : '🗃 Archive all'}
              </button>
            )}
            <button onClick={() => setShowArchived(v => !v)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition whitespace-nowrap
                ${showArchived ? 'bg-amber-50 text-amber-700 border-amber-200' : 'text-gray-500 border-gray-200 hover:bg-gray-50'}`}>
              {showArchived ? '← Active log' : '🗃 Archived'}
            </button>
          </div>

          {/* Log */}
          <div className={C}>
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Notification Log</h2>
              <p className="text-xs text-gray-400">{filtered.length} records</p>
            </div>
            {smsLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor:'#0d9f9f', borderTopColor:'transparent' }} />
              </div>
            ) : !filtered.length ? (
              <div className="text-center py-16">
                <p className="text-sm text-gray-400">No notifications found</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {filtered.map(n => (
                  <div key={n.id} className="flex items-start gap-4 px-5 py-3.5 hover:bg-gray-50 transition">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-lg mt-0.5"
                      style={{ background: n.status === 'sent' ? '#dcfce7' : n.status === 'failed' ? '#fee2e2' : '#dbeafe' }}>
                      📱
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-sm font-medium text-gray-900">{n.tenant_name ?? n.recipient}</p>
                        {n.unit_number && <span className="text-xs text-gray-400">· Unit {n.unit_number}</span>}
                        {n.property_name && <span className="text-xs text-gray-400">· {n.property_name}</span>}
                        <span className={`ml-auto px-2 py-0.5 rounded-full text-xs font-semibold ${SMS_STATUS[n.status]?.cls ?? ''}`}>
                          {SMS_STATUS[n.status]?.label ?? n.status}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 line-clamp-2">{n.body}</p>
                      {n.at_error && <p className="text-xs text-red-500 mt-0.5">Error: {n.at_error}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <p className="text-xs text-gray-400">{DATE(n.created_at)}</p>
                      {n.status === 'failed' && !showArchived && (
                        <button onClick={() => retry(n.id)} disabled={retrying === n.id}
                          className="text-xs text-teal-600 hover:text-teal-800 font-medium disabled:opacity-50">
                          {retrying === n.id ? 'Retrying…' : '↺ Retry'}
                        </button>
                      )}
                      {!showArchived && (
                        <button onClick={() => archiveOne(n.id)}
                          className="text-xs text-gray-400 hover:text-gray-600 transition">
                          🗃
                        </button>
                      )}
                      {n.archived_at && (
                        <p className="text-xs text-amber-500">Archived</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── IN-APP ALERTS TAB ── */}
      {tab === 'inapp' && (
        <div className={C}>
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">
              In-App Alerts {unread > 0 && <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-semibold bg-teal-50 text-teal-700">{unread} unread</span>}
            </h2>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs text-teal-600 hover:text-teal-800 font-medium">
                Mark all read
              </button>
            )}
          </div>
          {inAppLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor:'#0d9f9f', borderTopColor:'transparent' }} />
            </div>
          ) : !(inAppData?.items?.length) ? (
            <div className="text-center py-16">
              <p className="text-sm text-gray-400">No in-app alerts yet</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {inAppData.items.map(a => (
                <div key={a.id}
                  onClick={() => { const url = a.action_url ?? a.link; if (url) navigate(url); }}
                  className={`flex items-start gap-4 px-5 py-3.5 transition ${!a.is_read ? 'bg-teal-50/30' : ''} ${(a.action_url ?? a.link) ? 'cursor-pointer hover:bg-teal-50' : 'hover:bg-gray-50'}`}>
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-lg mt-0.5"
                    style={{ background: a.is_read ? '#f3f4f6' : '#e6fafa' }}>
                    {ALERT_ICON[a.type] ?? 'ℹ️'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={`text-sm font-medium ${a.is_read ? 'text-gray-600' : 'text-gray-900'}`}>{a.title}</p>
                      {!a.is_read && <span className="w-2 h-2 rounded-full bg-teal-500 shrink-0" />}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{a.body}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <p className="text-xs text-gray-400">{DATE(a.created_at)}</p>
                    {(a.action_url ?? a.link) && (
                      <svg className="w-3 h-3 text-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                      </svg>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TEST TAB ── */}
      {tab === 'test' && (
        <div className="max-w-lg">
          <div className={`${C} p-6`}>
            <h2 className="text-base font-semibold text-gray-900 mb-1">Send Test SMS</h2>
            <p className="text-sm text-gray-500 mb-5">Verify your Africa's Talking integration is working correctly.</p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                <input value={testPhone} onChange={e => setTestPhone(e.target.value)}
                  placeholder="+254712345678"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
                <textarea value={testMsg} onChange={e => setTestMsg(e.target.value)} rows={3}
                  maxLength={160}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
                <p className="text-xs text-gray-400 mt-1 text-right">{testMsg.length}/160</p>
              </div>
              <button onClick={sendTest} disabled={testing || !testPhone.trim()}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: '#0d9f9f' }}>
                {testing ? 'Sending…' : 'Send Test SMS'}
              </button>
              {!testPhone.trim() && !testing && (
                <p className="text-xs text-gray-400 text-center -mt-1">Enter a phone number above to enable sending</p>
              )}
            </div>

            {testResult && (
              <div className={`mt-4 p-4 rounded-xl border text-sm ${testResult.sent ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
                {testResult.sent
                  ? `✅ SMS sent successfully! Environment: ${testResult.environment ?? 'sandbox'}`
                  : `❌ Send failed: ${testResult.error}`}
              </div>
            )}
          </div>

          <div className={`${C} p-5 mt-4`}>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Environment Info</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Mode</span>
                {testResult?.environment
                  ? <span className={`font-medium px-2 py-0.5 rounded-full text-xs ${testResult.environment === 'production' ? 'text-emerald-700 bg-emerald-50' : 'text-amber-600 bg-amber-50'}`}>
                      {testResult.environment === 'production' ? 'Production (Live)' : 'Sandbox'}
                    </span>
                  : <span className="font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full text-xs">Production (Live)</span>
                }
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Username</span>
                <span className="font-mono text-gray-700 text-xs">PropManagerco</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Provider</span>
                <span className="text-gray-700 text-xs">Africa's Talking</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}