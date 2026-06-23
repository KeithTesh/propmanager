// web/src/pages/superadmin/SuperAdminPage.tsx

import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { apiClient, getApiErrorMessage } from '../../lib/api';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../components/ui/Toast';

interface Stats {
  total_companies: string; active: string; trialing: string;
  suspended: string; cancelled: string;
  trials_expiring_soon: string; mrr: string; new_this_month: string;
}

interface Company {
  id: string; name: string; trading_name: string | null;
  email: string; phone: string; county: string | null;
  plan: string; subscription_status: string;
  monthly_fee: string; unit_limit: number; sms_quota_monthly: number;
  trial_ends_at: string | null; subscription_ends_at: string | null;
  next_billing_at: string | null; suspended_at: string | null;
  suspension_reason: string | null; setup_completed: boolean;
  created_at: string; notes: string | null;
  owner_name: string | null; owner_email: string | null;
  owner_phone: string | null; owner_last_login: string | null;
  property_count: string; unit_count: string;
  active_leases: string; tenant_count: string;
  account_type: string;
}

interface SubEvent {
  id: string; company_name?: string;
  event_type: string; new_status: string | null; new_plan: string | null;
  amount: string | null; notes: string | null;
  performed_by_name: string | null; created_at: string;
}

const KES = (n: string | number) => `KES ${Number(n).toLocaleString('en-KE')}`;
const DATE = (d: string | null) => d ? new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const RELATIVE = (d: string | null) => {
  if (!d) return '—';
  const days = Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days === 0) return 'Today';
  return `in ${days}d`;
};

const STATUS_STYLE: Record<string, { bg: string; text: string; dot: string }> = {
  active:    { bg: '#f0fdf4', text: '#15803d', dot: '#22c55e' },
  trialing:  { bg: '#eff6ff', text: '#1d4ed8', dot: '#3b82f6' },
  suspended: { bg: '#fff7ed', text: '#c2410c', dot: '#f97316' },
  cancelled: { bg: '#fef2f2', text: '#b91c1c', dot: '#ef4444' },
  expired:   { bg: '#f9fafb', text: '#6b7280', dot: '#9ca3af' },
};

const PLAN_COLOR: Record<string, string> = {
  trial: '#6b7280', starter: '#0d9f9f', growth: '#7c3aed', pro: '#1d4ed8', enterprise: '#b45309',
  starter_agent: '#0891b2', growth_agent: '#7c3aed', enterprise_agent: '#b45309',
};

const ACCT_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  landlord: { label: '🏠 Landlord', bg: '#f0fdf4', color: '#166534' },
  agent:    { label: '🏢 Agent',    bg: '#faf5ff', color: '#6d28d9' },
};

export default function SuperAdminPage() {
  const qc = useQueryClient();
  const { confirm } = useConfirm();
  const { toast } = useToast();
  const [tab, setTab]         = useState<'companies' | 'events' | 'pending' | 'settings' | 'deleted' | 'sms'>('companies');
  const [search, setSearch]   = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState<Company | null>(null);

  const { data: statsData } = useQuery({
    queryKey: ['sa-stats'],
    queryFn:  () => apiClient.get('/superadmin/stats').then((r: any) => r.data.data),
  });
  const { data: companiesData, isLoading } = useQuery({
    queryKey: ['sa-companies', search, statusFilter],
    queryFn:  () => apiClient.get(`/superadmin/companies?search=${search}&status=${statusFilter}`).then((r: any) => r.data.data.companies as Company[]),
  });
  const { data: pendingData, refetch: refetchPending } = useQuery({
    queryKey: ['sa-pending'],
    queryFn:  () => apiClient.get('/superadmin/pending').then((r: any) => r.data.data),
    enabled:  tab === 'pending',
    refetchInterval: 30_000,
  });

  const approveSender = useMutation({
    mutationFn: (id: string) => apiClient.post(`/superadmin/sender-id/${id}/approve`),
    onSuccess: () => { refetchPending(); toast({ title: "Sender ID approved", variant: 'success' }); },
    onError:   (e: any) => toast({ title: getApiErrorMessage(e), variant: 'error' }),
  });
  const rejectSender = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => apiClient.post(`/superadmin/sender-id/${id}/reject`, { note }),
    onSuccess: () => { refetchPending(); toast({ title: "Request rejected", variant: 'success' }); },
    onError:   (e: any) => toast({ title: getApiErrorMessage(e), variant: 'error' }),
  });
  const approveQuota = useMutation({
    mutationFn: (id: string) => apiClient.post(`/superadmin/quota/${id}/approve`),
    onSuccess: () => { refetchPending(); toast({ title: "Quota approved", variant: 'success' }); },
    onError:   (e: any) => toast({ title: getApiErrorMessage(e), variant: 'error' }),
  });
  const rejectQuota = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => apiClient.post(`/superadmin/quota/${id}/reject`, { note }),
    onSuccess: () => { refetchPending(); toast({ title: "Request rejected", variant: 'success' }); },
    onError:   (e: any) => toast({ title: getApiErrorMessage(e), variant: 'error' }),
  });

  const { data: deletedData, refetch: refetchDeleted } = useQuery({
    queryKey: ['sa-deleted'],
    queryFn: () => apiClient.get('/superadmin/deleted').then((r: any) => r.data.data.companies),
    enabled: tab === 'deleted',
    refetchInterval: tab === 'deleted' ? 30_000 : false,
  });

  const restoreCompany = useMutation({
    mutationFn: (id: string) => apiClient.post(`/superadmin/companies/${id}/restore`),
    onSuccess: () => { refetchDeleted(); invalidate(); toast({ title: "Company restored successfully", variant: 'success' }); },
    onError: (e: any) => toast({ title: getApiErrorMessage(e), variant: 'error' }),
  });

  const { data: smsUsageData } = useQuery({
    queryKey: ['sa-sms-usage'],
    queryFn: () => apiClient.get('/superadmin/sms-usage').then((r: any) => r.data.data),
    enabled: tab === 'sms',
    refetchInterval: tab === 'sms' ? 60_000 : false,
  });

  const { data: settingsData, refetch: refetchSettings } = useQuery({
    queryKey: ['sa-settings'],
    queryFn: () => apiClient.get('/superadmin/platform-settings').then((r: any) => r.data.data.settings as {key:string;value:string;description:string}[]),
    enabled: tab === 'settings',
  });

  const [editedSettings, setEditedSettings] = useState<Record<string,string>>({});
  const saveSettings = useMutation({
    mutationFn: (updates: Record<string,string>) => apiClient.patch('/superadmin/platform-settings', updates),
    onSuccess: () => { refetchSettings(); toast({ title: "Settings saved", variant: 'success' }); setEditedSettings({}); },
    onError: (e: any) => toast({ title: getApiErrorMessage(e), variant: 'error' }),
  });

  const senderRequests = pendingData?.senderRequests ?? [];
  const quotaRequests  = pendingData?.quotaRequests  ?? [];
  const pendingCount   = senderRequests.length + quotaRequests.length;

  const { data: eventsData } = useQuery({
    queryKey: ['sa-events'],
    queryFn:  () => apiClient.get('/superadmin/events').then((r: any) => r.data.data.events as SubEvent[]),
    enabled:  tab === 'events',
  });

  const stats: Stats | undefined = statsData?.stats;
  const companies = companiesData ?? [];

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['sa-stats'] });
    qc.invalidateQueries({ queryKey: ['sa-companies'] });
    qc.invalidateQueries({ queryKey: ['sa-events'] });
  }

  const suspend = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient.post(`/superadmin/companies/${id}/suspend`, { reason }),
    onSuccess: () => { invalidate(); setSelected(null); toast({ title: "Company suspended", variant: 'success' }); },
    onError:   (e: any) => toast({ title: getApiErrorMessage(e), variant: 'error' }),
  });
  const activate = useMutation({
    mutationFn: (id: string) => apiClient.post(`/superadmin/companies/${id}/activate`, { billingDays: 30 }),
    onSuccess: () => { invalidate(); setSelected(null); toast({ title: "Subscription activated", variant: 'success' }); },
    onError:   (e: any) => toast({ title: getApiErrorMessage(e), variant: 'error' }),
  });
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient.post(`/superadmin/companies/${id}/cancel`, { reason }),
    onSuccess: () => { invalidate(); setSelected(null); toast({ title: "Subscription cancelled", variant: 'success' }); },
    onError:   (e: any) => toast({ title: getApiErrorMessage(e), variant: 'error' }),
  });
  const deleteCompany = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/superadmin/companies/${id}`, { data: { confirm: 'DELETE' } }),
    onSuccess: () => { invalidate(); setSelected(null); toast({ title: "Company deleted", variant: 'success' }); },
    onError:   (e: any) => toast({ title: getApiErrorMessage(e), variant: 'error' }),
  });

  async function handleSuspend(c: Company) {
    const reason = window.prompt(`Reason for suspending ${c.name}:`);
    if (!reason?.trim()) return;
    if (await confirm({ title: `Suspend ${c.name}?`, message: `Blocks all API access immediately. Reason: ${reason}`, confirmLabel: 'Suspend', variant: 'danger' }))
      suspend.mutate({ id: c.id, reason });
  }
  async function handleCancel(c: Company) {
    const reason = window.prompt(`Reason for cancelling ${c.name}:`);
    if (!reason?.trim()) return;
    if (await confirm({ title: `Cancel ${c.name}?`, message: 'Cancels their subscription.', confirmLabel: 'Cancel', variant: 'danger' }))
      cancel.mutate({ id: c.id, reason });
  }
  async function handleDelete(c: Company) {
    if (await confirm({ title: `Delete ${c.name}?`, message: 'PERMANENTLY deletes this company and ALL data. Irreversible.', confirmLabel: 'Delete Forever', variant: 'danger' }))
      deleteCompany.mutate(c.id);
  }

  if (selected) return (
    <CompanyDetail company={selected} onBack={() => setSelected(null)}
      onActivate={() => activate.mutate(selected.id)}
      onSuspend={() => handleSuspend(selected)}
      onCancel={() => handleCancel(selected)}
      onDelete={() => handleDelete(selected)} />
  );

  const C = { background: 'white', borderRadius: 14, border: '1px solid #e2e8f0' };

  return (
    <div style={{ padding: '28px 32px', minHeight: '100vh', background: '#f8fafc' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', margin: 0 }}>PropManager Admin</h1>
        <p style={{ color: '#64748b', fontSize: 13, margin: '3px 0 0' }}>{stats?.total_companies ?? '—'} companies on platform</p>
      </div>

      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 28 }}>
          {[
            { label: 'MRR',           value: KES(stats.mrr),             color: '#0d9f9f' },
            { label: 'Active',        value: stats.active,               color: '#22c55e' },
            { label: 'Trialing',      value: stats.trialing,             color: '#3b82f6', sub: `${stats.trials_expiring_soon} expiring soon` },
            { label: 'Suspended',     value: stats.suspended,            color: '#f97316' },
            { label: 'New (30d)',      value: stats.new_this_month,       color: '#7c3aed' },
          ].map(s => (
            <div key={s.label} style={{ ...C, padding: '16px 18px' }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: '0.05em', margin: 0 }}>{s.label}</p>
              <p style={{ fontSize: 26, fontWeight: 800, color: s.color, margin: '4px 0 2px', letterSpacing: '-1px' }}>{s.value}</p>
              {s.sub && <p style={{ fontSize: 11, color: '#f97316', margin: 0 }}>{s.sub}</p>}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '2px solid #e2e8f0' }}>
        {(['companies', 'pending', 'sms', 'events', 'deleted', 'settings'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '8px 18px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              color: tab === t ? '#0d9f9f' : '#94a3b8', borderBottom: tab === t ? '2px solid #0d9f9f' : '2px solid transparent', marginBottom: -2 }}>
            {t === 'pending' ? `Pending${pendingCount > 0 ? ` (${pendingCount})` : ''}` : t === 'deleted' ? '🗑 Deleted' : t === 'sms' ? '📩 SMS Usage' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'companies' && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search company or email…"
              style={{ flex: 1, padding: '9px 14px', borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13, outline: 'none' }} />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              style={{ padding: '9px 14px', borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13, background: 'white', cursor: 'pointer' }}>
              <option value="">All statuses</option>
              {['active','trialing','suspended','cancelled','expired'].map(s => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </div>

          <div style={{ ...C, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' as const }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                    {['Company','Plan','Status','MRR','Units','Trial / Next Bill','Actions'].map(h => (
                      <th key={h} style={{ padding: '11px 14px', textAlign: 'left' as const, fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: '0.05em', whiteSpace: 'nowrap' as const }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center' as const, color: '#94a3b8' }}>Loading…</td></tr>
                  ) : companies.length === 0 ? (
                    <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center' as const, color: '#94a3b8' }}>No companies found</td></tr>
                  ) : companies.map(c => {
                    const st = STATUS_STYLE[c.subscription_status] ?? STATUS_STYLE.expired;
                    const trialExpired = c.trial_ends_at && new Date(c.trial_ends_at) < new Date();
                    return (
                      <tr key={c.id} style={{ borderBottom: '1px solid #f8fafc', cursor: 'pointer' }} onClick={() => setSelected(c)}>
                        <td style={{ padding: '12px 14px' }}>
                          <p style={{ fontWeight: 700, color: '#0f172a', margin: 0 }}>{c.name}</p>
                          <p style={{ color: '#94a3b8', margin: '1px 0 0', fontSize: 11 }}>{c.owner_name ?? c.email}</p>
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: PLAN_COLOR[c.plan] + '18', color: PLAN_COLOR[c.plan] }}>
                            {c.plan.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: st.bg, color: st.text }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: st.dot, flexShrink: 0 }} />
                            {c.subscription_status}
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px', fontWeight: 700, color: '#0f172a' }}>{KES(c.monthly_fee)}</td>
                        <td style={{ padding: '12px 14px', color: '#334155' }}>
                          {c.unit_count}/{c.unit_limit}
                        </td>
                        <td style={{ padding: '12px 14px', fontSize: 11, color: trialExpired ? '#ef4444' : '#64748b' }}>
                          {c.subscription_status === 'trialing'
                            ? `Trial ${RELATIVE(c.trial_ends_at)}`
                            : `Bill ${RELATIVE(c.next_billing_at)}`}
                        </td>
                        <td style={{ padding: '12px 14px' }} onClick={e => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            {c.subscription_status === 'suspended' ? (
                              <button onClick={() => activate.mutate(c.id)}
                                style={{ padding: '5px 10px', borderRadius: 7, border: 'none', background: '#f0fdf4', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: '#15803d' }}>
                                Activate
                              </button>
                            ) : !['cancelled'].includes(c.subscription_status) ? (
                              <button onClick={() => handleSuspend(c)}
                                style={{ padding: '5px 10px', borderRadius: 7, border: 'none', background: '#fff7ed', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: '#c2410c' }}>
                                Suspend
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'pending' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Sender ID requests */}
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: '0 0 12px' }}>Sender ID Requests ({senderRequests.length})</h3>
            {senderRequests.length === 0 ? (
              <div style={{ ...C, padding: 20, textAlign: 'center' as const, color: '#94a3b8', fontSize: 13 }}>No pending sender ID requests</div>
            ) : senderRequests.map((r: any) => (
              <div key={r.id} style={{ ...C, padding: 16, marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <p style={{ fontWeight: 700, color: '#0f172a', margin: 0 }}>{r.company_name}</p>
                    <p style={{ color: '#64748b', fontSize: 12, margin: '2px 0' }}>Requested by: {r.requested_by_name}</p>
                    <p style={{ color: '#0d9f9f', fontSize: 13, margin: '4px 0 0', fontWeight: 600 }}>Sender ID: {r.sender_id}</p>
                    <p style={{ color: '#64748b', fontSize: 12, margin: '2px 0' }}>AT Username: {r.at_username}</p>
                    {r.reason && <p style={{ color: '#64748b', fontSize: 12, margin: '2px 0' }}>Reason: {r.reason}</p>}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => approveSender.mutate(r.id)}
                      style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#f0fdf4', color: '#15803d', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                      ✅ Approve
                    </button>
                    <button onClick={async () => {
                      const note = window.prompt('Rejection reason:');
                      if (note?.trim()) rejectSender.mutate({ id: r.id, note });
                    }}
                      style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#fef2f2', color: '#b91c1c', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                      ❌ Reject
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Quota requests */}
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: '0 0 12px' }}>SMS Quota Requests ({quotaRequests.length})</h3>
            {quotaRequests.length === 0 ? (
              <div style={{ ...C, padding: 20, textAlign: 'center' as const, color: '#94a3b8', fontSize: 13 }}>No pending quota requests</div>
            ) : quotaRequests.map((r: any) => (
              <div key={r.id} style={{ ...C, padding: 16, marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p style={{ fontWeight: 700, color: '#0f172a', margin: 0 }}>{r.company_name}</p>
                    <p style={{ color: '#64748b', fontSize: 12, margin: '2px 0' }}>Requested by: {r.requested_by_name}</p>
                    <p style={{ color: '#64748b', fontSize: 13, margin: '4px 0 0' }}>
                      <span style={{ color: '#94a3b8' }}>{r.current_quota} SMS</span>
                      {' → '}
                      <strong style={{ color: '#0d9f9f' }}>{r.requested_quota} SMS</strong>
                      {' per month'}
                    </p>
                    {r.reason && <p style={{ color: '#64748b', fontSize: 12, margin: '2px 0' }}>Reason: {r.reason}</p>}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => approveQuota.mutate(r.id)}
                      style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#f0fdf4', color: '#15803d', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                      ✅ Approve
                    </button>
                    <button onClick={async () => {
                      const note = window.prompt('Rejection reason:');
                      if (note?.trim()) rejectQuota.mutate({ id: r.id, note });
                    }}
                      style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#fef2f2', color: '#b91c1c', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                      ❌ Reject
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}



      {tab === 'sms' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Platform totals */}
          {smsUsageData?.totals && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
              {[
                { label: 'Total Sent This Month', value: Number(smsUsageData.totals.total_used_this_month ?? 0).toLocaleString(), color: '#0d9f9f' },
                { label: 'Total Monthly Quota',   value: Number(smsUsageData.totals.total_quota ?? 0).toLocaleString(), color: '#7c3aed' },
                { label: 'Companies w/ Sender ID', value: smsUsageData.totals.companies_with_sender_id ?? 0, color: '#f59e0b' },
              { label: 'Agent Accounts', value: smsUsageData.totals.agent_count ?? 0, color: '#6d28d9' },
              ].map(s => (
                <div key={s.label} style={{ ...C, padding: '16px 18px' }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: '0.05em', margin: 0 }}>{s.label}</p>
                  <p style={{ fontSize: 26, fontWeight: 800, color: s.color, margin: '4px 0 0', letterSpacing: '-1px' }}>{s.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Per-company usage */}
          <div style={{ ...C, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9' }}>
              <p style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', margin: 0 }}>SMS Usage by Company</p>
              <p style={{ fontSize: 12, color: '#94a3b8', margin: '2px 0 0' }}>Current month · Resets monthly</p>
            </div>
            {(smsUsageData?.companies ?? []).length === 0 ? (
              <p style={{ padding: 40, textAlign: 'center' as const, color: '#94a3b8', fontSize: 13, margin: 0 }}>No SMS usage data yet</p>
            ) : (smsUsageData?.companies ?? []).map((co: any) => {
              const pct = Math.min(100, parseFloat(co.usage_pct ?? 0));
              const barColor = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#0d9f9f';
              return (
                <div key={co.id} style={{ padding: '14px 18px', borderBottom: '1px solid #f8fafc' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div>
                      <p style={{ fontWeight: 600, fontSize: 13, color: '#0f172a', margin: 0 }}>{co.name}</p>
                      <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0' }}>
                        {co.at_sender_id ? <span style={{ color: '#0d9f9f', fontWeight: 600 }}>✓ {co.at_sender_id}</span> : <span>Shared sender ID</span>}
                      </p>
                    </div>
                    <div style={{ textAlign: 'right' as const }}>
                      <p style={{ fontWeight: 700, fontSize: 13, color: barColor, margin: 0 }}>{Number(co.used).toLocaleString()} / {Number(co.quota).toLocaleString()}</p>
                      <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0' }}>{pct.toFixed(1)}% used</p>
                    </div>
                  </div>
                  <div style={{ height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 3, width: `${pct}%`, background: barColor, transition: 'width .5s ease' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'deleted' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
            Deleted companies can be restored within <strong>30 days</strong>. After that they are permanently purged.
          </p>
          {!deletedData || deletedData.length === 0 ? (
            <div style={{ ...C, padding: 40, textAlign: 'center' as const, color: '#94a3b8', fontSize: 13 }}>
              No deleted companies in the restore window
            </div>
          ) : deletedData.map((c: any) => (
            <div key={c.id} style={{ ...C, padding: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div>
                  <p style={{ fontWeight: 700, color: '#0f172a', margin: 0 }}>{c.name}</p>
                  <p style={{ fontSize: 12, color: '#94a3b8', margin: '2px 0 0' }}>{c.email} · {c.owner_name ?? 'No owner'}</p>
                  <p style={{ fontSize: 12, margin: '4px 0 0', color: c.days_to_purge <= 7 ? '#ef4444' : '#f97316', fontWeight: 600 }}>
                    ⏳ {c.days_to_purge === 0 ? 'Purges today' : `${c.days_to_purge} day${c.days_to_purge === 1 ? '' : 's'} until permanent deletion`}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    if (window.confirm(`Restore ${c.name}? This will reactivate the company and all its users.`)) {
                      restoreCompany.mutate(c.id);
                    }
                  }}
                  style={{ padding: '8px 16px', borderRadius: 9, border: 'none', background: '#f0fdf4', color: '#15803d', fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' as const }}>
                  ↩ Restore
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'settings' && (
        <div style={{ maxWidth: 680 }}>
          <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>These settings control the platform globally. Changes take effect immediately for new signups.</p>
          <div style={{ ...C, padding: 24 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.05em', margin: '0 0 20px' }}>Platform Settings</h3>
            {(settingsData ?? []).map((s: any) => (
              <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid #f1f5f9' }}>
                <div style={{ flex: 1 }}>
                  <p style={{ fontWeight: 600, fontSize: 13, color: '#0f172a', margin: 0 }}>{s.key.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}</p>
                  <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0' }}>{s.description}</p>
                </div>
                <input
                  value={editedSettings[s.key] ?? s.value}
                  onChange={e => setEditedSettings(prev => ({...prev, [s.key]: e.target.value}))}
                  style={{ width: 140, padding: '7px 12px', borderRadius: 8, border: `1px solid ${editedSettings[s.key] !== undefined && editedSettings[s.key] !== s.value ? '#0d9f9f' : '#e2e8f0'}`, fontSize: 13, outline: 'none' }}
                />
              </div>
            ))}
            {Object.keys(editedSettings).length > 0 && (
              <button
                onClick={() => saveSettings.mutate(editedSettings)}
                style={{ padding: '10px 20px', background: '#0d9f9f', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', marginTop: 8 }}>
                Save {Object.keys(editedSettings).length} change{Object.keys(editedSettings).length > 1 ? 's' : ''}
              </button>
            )}
          </div>
        </div>
      )}

      {tab === 'events' && (
        <div style={{ ...C, overflow: 'hidden' }}>
          {(eventsData ?? []).length === 0 ? (
            <p style={{ padding: 40, textAlign: 'center' as const, color: '#94a3b8', margin: 0 }}>No events yet</p>
          ) : (eventsData ?? []).map(e => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 18px', borderBottom: '1px solid #f8fafc' }}>
              <span style={{ fontSize: 18 }}>
                {({ activated: '✅', suspended: '🚫', cancelled: '❌', plan_changed: '📋', trial_started: '🆓', payment_received: '💰' } as any)[e.event_type] ?? '📋'}
              </span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                  {e.company_name} — <span style={{ color: '#64748b' }}>{e.event_type.replace(/_/g, ' ')}</span>
                </p>
                {e.notes && <p style={{ margin: '1px 0 0', fontSize: 11, color: '#94a3b8' }}>{e.notes}</p>}
              </div>
              <div style={{ textAlign: 'right' as const }}>
                {e.amount && <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#0d9f9f' }}>{KES(e.amount)}</p>}
                <p style={{ margin: 0, fontSize: 11, color: '#94a3b8' }}>{DATE(e.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CompanyDetail({ company: c, onBack, onActivate, onSuspend, onCancel, onDelete }: {
  company: Company; onBack: () => void;
  onActivate: () => void; onSuspend: () => void; onCancel: () => void; onDelete: () => void;
}) {
  const qc2 = useQueryClient();
  const st = STATUS_STYLE[c.subscription_status] ?? STATUS_STYLE.expired;
  const C2 = { background: 'white', borderRadius: 16, padding: 20, border: '1px solid #e2e8f0' };

  const [planEdit, setPlanEdit] = useState({
    plan:       c.plan,
    monthlyFee: String(c.monthly_fee),
    unitLimit:  String(c.unit_limit),
    smsQuota:   String(c.sms_quota_monthly ?? 500),
    notes:      '',
  });
  const [savingPlan, setSavingPlan] = useState(false);

  async function savePlan() {
    setSavingPlan(true);
    try {
      await apiClient.patch(`/superadmin/companies/${c.id}/plan`, {
        plan:       planEdit.plan,
        monthlyFee: Number(planEdit.monthlyFee),
        unitLimit:  Number(planEdit.unitLimit),
        smsQuota:   Number(planEdit.smsQuota),
        notes:      planEdit.notes || undefined,
      });
      qc2.invalidateQueries({ queryKey: ['sa-companies'] });
      toast({ title: 'Plan & limits updated', variant: 'success' });
    } catch(e: any) {
      toast({ title: getApiErrorMessage(e), variant: 'error' });
    }
    setSavingPlan(false);
  }

  return (
    <div style={{ padding: '28px 32px' }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#0d9f9f', fontWeight: 600, fontSize: 13, cursor: 'pointer', marginBottom: 20, padding: 0 }}>← Back</button>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={C2}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', margin: 0 }}>{c.name}</h2>
                <p style={{ color: '#94a3b8', fontSize: 12, margin: '4px 0 0' }}>{c.email} · {c.phone}</p>
              </div>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: st.bg, color: st.text }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: st.dot }} />
                {c.subscription_status}
              </span>
            </div>
            {c.suspension_reason && (
              <div style={{ marginTop: 12, padding: '10px 14px', background: '#fff7ed', borderRadius: 10 }}>
                <p style={{ margin: 0, fontSize: 12, color: '#c2410c', fontWeight: 600 }}>Suspended: {c.suspension_reason}</p>
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {[['Properties', c.property_count],['Units', c.unit_count],['Leases', c.active_leases],['Tenants', c.tenant_count]].map(([l,v]) => (
              <div key={l as string} style={{ background: 'white', borderRadius: 12, padding: 14, border: '1px solid #e2e8f0', textAlign: 'center' as const }}>
                <p style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0 }}>{v}</p>
                <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0' }}>{l}</p>
              </div>
            ))}
          </div>

          <div style={C2}>
            <h3 style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: '0.05em', margin: '0 0 12px' }}>Owner</h3>
            <p style={{ fontWeight: 700, color: '#0f172a', margin: 0 }}>{c.owner_name ?? 'Not set up'}</p>
            <p style={{ color: '#64748b', fontSize: 12, margin: '2px 0' }}>{c.owner_email} · {c.owner_phone}</p>
            <p style={{ color: '#94a3b8', fontSize: 11, margin: '4px 0 0' }}>Last login: {c.owner_last_login ? DATE(c.owner_last_login) : 'Never'}</p>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={C2}>
            <h3 style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: '0.05em', margin: '0 0 14px' }}>Subscription</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                ['Plan',      <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 700, background: PLAN_COLOR[c.plan]+'18', color: PLAN_COLOR[c.plan] }}>{c.plan.toUpperCase()}</span>],
                ['Account Type', (() => { const b = ACCT_BADGE[c.account_type] ?? ACCT_BADGE.landlord; return <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 700, background: b.bg, color: b.color }}>{b.label}</span>; })()],
                ['MRR',       <strong style={{ color: '#0d9f9f' }}>{KES(c.monthly_fee)}</strong>],
                ['Units',     `${c.unit_count} / ${c.unit_limit}`],
                ['Setup',     c.setup_completed ? '✅ Done' : '⏳ Incomplete'],
                ['Trial ends',DATE(c.trial_ends_at)],
                ['Sub ends',  DATE(c.subscription_ends_at)],
                ['Next bill', DATE(c.next_billing_at)],
                ['Joined',    DATE(c.created_at)],
              ].map(([label, value]) => (
                <div key={label as string} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                  <span style={{ color: '#64748b' }}>{label}</span>
                  <span style={{ color: '#0f172a' }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={C2}>
            <h3 style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: '0.05em', margin: '0 0 14px' }}>Edit Plan & Limits</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Plan</label>
                <select value={planEdit.plan} onChange={e => setPlanEdit(p => ({ ...p, plan: e.target.value }))}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, background: 'white' }}>
                  {['trial','starter','growth','pro','enterprise','starter_agent','growth_agent','enterprise_agent'].map(p => <option key={p} value={p}>{p.replace(/_/g,' ').replace(/\b\w/g, (l:string)=>l.toUpperCase())}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Monthly Fee (KES)</label>
                <input type="number" value={planEdit.monthlyFee} onChange={e => setPlanEdit(p => ({ ...p, monthlyFee: e.target.value }))}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Unit Limit</label>
                <input type="number" value={planEdit.unitLimit} onChange={e => setPlanEdit(p => ({ ...p, unitLimit: e.target.value }))}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Monthly SMS Quota</label>
                <input type="number" value={planEdit.smsQuota} onChange={e => setPlanEdit(p => ({ ...p, smsQuota: e.target.value }))}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Notes (optional)</label>
                <input value={planEdit.notes} onChange={e => setPlanEdit(p => ({ ...p, notes: e.target.value }))}
                  placeholder="Reason for change…"
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }} />
              </div>
              <button onClick={savePlan} disabled={savingPlan}
                style={{ padding: '9px 14px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#0d9f9f,#076666)', color: 'white', fontWeight: 700, fontSize: 13, cursor: savingPlan ? 'not-allowed' : 'pointer', opacity: savingPlan ? 0.6 : 1 }}>
                {savingPlan ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>

          <div style={C2}>
            <h3 style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: '0.05em', margin: '0 0 14px' }}>Actions</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(c.subscription_status === 'suspended' || c.subscription_status === 'trialing') &&
                <Btn onClick={onActivate} color="#0d9f9f" label="✅ Activate Subscription" />}
              {!['suspended','cancelled'].includes(c.subscription_status) &&
                <Btn onClick={onSuspend} color="#f97316" label="🚫 Suspend Account" />}
              {c.subscription_status === 'suspended' &&
                <Btn onClick={onCancel} color="#ef4444" label="❌ Cancel Subscription" />}
              <div style={{ height: 1, background: '#f1f5f9', margin: '4px 0' }} />
              <Btn onClick={onDelete} color="#dc2626" label="🗑 Delete Company" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Btn({ onClick, color, label }: { onClick: () => void; color: string; label: string }) {
  return (
    <button onClick={onClick}
      style={{ padding: '10px 14px', borderRadius: 10, border: `1px solid ${color}30`,
        background: color + '10', color, fontWeight: 600, fontSize: 13, cursor: 'pointer', textAlign: 'left' as const }}>
      {label}
    </button>
  );
}