// web/src/pages/sms/SmsPage.tsx

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, getApiErrorMessage } from '../../lib/api';
import { toast } from '../../components/ui/toaster';
import { useConfirm } from '../../components/ui/ConfirmDialog';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Template {
  id: string; type: string; name: string; template: string;
  is_active: boolean; updated_at: string;
}

interface Blast {
  id: string; subject: string; message: string;
  target_type: string; target_label: string;
  total_sent: number; total_failed: number; total_skipped: number;
  status: string; created_by_name: string; created_at: string; completed_at: string | null;
}

interface Property { id: string; name: string; }
interface Tenant   { id: string; full_name: string; unit_number: string; property_name: string; }

interface UsageData {
  company: { sms_quota_monthly: number; sms_used_this_month: number; at_sender_id: string | null };
  monthStats: { total_sent: string; successful: string; failed: string; total_cost: string };
  history: { month: string; sent: string; failed: string; parts: string }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEMPLATE_LABELS: Record<string, { label: string; icon: string; desc: string }> = {
  rent_reminder:        { label: 'Rent Reminder',        icon: '📅', desc: 'Sent when monthly reminders are blasted' },
  payment_confirmation: { label: 'Payment Confirmation', icon: '✅', desc: 'Sent after a payment is recorded' },
  overdue:              { label: 'Overdue Notice',        icon: '⚠️', desc: 'Sent for overdue bills' },
  penalty:              { label: 'Penalty Notice',        icon: '💸', desc: 'Sent when a penalty is applied' },
  custom_blast:         { label: 'Announcement',         icon: '📢', desc: 'Default for custom bulk messages' },
};

const PLACEHOLDERS = [
  { key: '{tenant_name}', desc: 'Tenant full name' },
  { key: '{amount}',      desc: 'KES amount' },
  { key: '{unit}',        desc: 'Unit number' },
  { key: '{month}',       desc: 'Bill month e.g. April 2026' },
  { key: '{due_date}',    desc: 'Due date' },
  { key: '{receipt}',     desc: 'Receipt number' },
  { key: '{paybill}',     desc: 'M-Pesa paybill' },
  { key: '{account_ref}', desc: 'Account reference' },
  { key: '{property}',    desc: 'Property name' },
];

const DATE = (d: string) => new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const inputCls = 'w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent';

type Tab = 'templates' | 'blast' | 'usage';

// ─── Component ────────────────────────────────────────────────────────────────

export default function SmsPage() {
  const qc = useQueryClient();
  const { confirm } = useConfirm();
  const [tab, setTab] = useState<Tab>('blast');

  // ── Template state ──
  const [editingType, setEditingType]   = useState<string | null>(null);
  const [editText, setEditText]         = useState('');
  const [editName, setEditName]         = useState('');
  const [preview, setPreview]           = useState('');
  const [savingTpl, setSavingTpl]       = useState(false);

  // ── Blast state ──
  const [subject, setSubject]           = useState(`SMS Blast — ${new Date().toLocaleDateString('en-KE', { month: 'long', year: 'numeric' })}`);
  const [message, setMessage]           = useState('');
  const [targetType, setTargetType]     = useState<'all'|'property'|'tenant'>('all');
  const [targetId, setTargetId]         = useState('');
  const [sending, setSending]           = useState(false);
  const [blastResult, setBlastResult]   = useState<{ sent: number; failed: number; skipped: number } | null>(null);
  const [recipientPreview, setRecipientPreview] = useState<{ count: number; recipients: any[] } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // ── Usage state ──
  const [quotaReq, setQuotaReq]         = useState('');
  const [quotaReason, setQuotaReason]   = useState('');
  const [submittingQuota, setSubmittingQuota] = useState(false);

  // ── Sender ID state ──
  const [senderForm, setSenderForm] = useState({ senderId: '', atUsername: '', atApiKey: '', reason: '' });
  const [submittingSender, setSubmittingSender] = useState(false);

  // ── Queries ──
  const { data: tplData } = useQuery({
    queryKey: ['sms-templates'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { templates: Template[]; placeholders: string[] } }>('/sms/templates');
      return res.data.data;
    },
  });

  const { data: blastData } = useQuery({
    queryKey: ['sms-blasts'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { blasts: Blast[] } }>('/sms/blasts');
      return res.data.data.blasts;
    },
    enabled: tab === 'blast',
  });

  const { data: usageData } = useQuery<UsageData>({
    queryKey: ['sms-usage'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: UsageData }>('/sms/usage');
      return res.data.data;
    },
    enabled: tab === 'usage',
  });

  const { data: senderStatus, refetch: refetchSender } = useQuery({
    queryKey: ['sender-id-status'],
    queryFn: () => apiClient.get('/sms/sender-id-request').then((r: any) => r.data.data.request),
    enabled: tab === 'usage',
  });

  const { data: properties } = useQuery({
    queryKey: ['properties-list'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { properties: Property[] } }>('/properties');
      return res.data.data.properties;
    },
  });

  const { data: tenants } = useQuery({
    queryKey: ['tenants-active'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { tenants: Tenant[] } }>('/tenants?limit=200');
      return res.data.data.tenants;
    },
  });

  // ── Template actions ──
  function startEdit(tpl: Template) {
    setEditingType(tpl.type);
    setEditText(tpl.template);
    setEditName(tpl.name);
    setPreview('');
  }

  async function previewTemplate() {
    try {
      const res = await apiClient.post<{ data: { preview: string; length: number; parts: number } }>(
        `/sms/templates/${editingType}/preview`, { template: editText }
      );
      setPreview(res.data.data.preview);
    } catch (e) { toast({ title: getApiErrorMessage(e), variant: 'error' }); }
  }

  async function saveTemplate() {
    if (!editingType) return;
    setSavingTpl(true);
    try {
      await apiClient.patch(`/sms/templates/${editingType}`, { template: editText, name: editName });
      toast({ title: "Template saved", variant: 'success' });
      qc.invalidateQueries({ queryKey: ['sms-templates'] });
      setEditingType(null);
    } catch (e) { toast({ title: getApiErrorMessage(e), variant: 'error' }); }
    finally { setSavingTpl(false); }
  }

  // ── Recipient preview ──
  async function loadRecipientPreview() {
    if (targetType !== 'all' && !targetId) return;
    setLoadingPreview(true);
    try {
      const res = await apiClient.post<{ data: { count: number; recipients: any[] } }>(
        '/sms/recipients-preview',
        { target_type: targetType, target_id: targetId || undefined }
      );
      setRecipientPreview(res.data.data);
    } catch (e) { toast({ title: getApiErrorMessage(e), variant: 'error' }); }
    finally { setLoadingPreview(false); }
  }

  useEffect(() => {
    setRecipientPreview(null);
  }, [targetType, targetId]);

  // ── Send blast ──
  async function sendBlast() {
    if (!subject.trim()) { toast({ title: "Enter a subject/label for this blast", variant: 'info' }); return; }
    if (!message.trim() || message.length < 5) { toast({ title: "Message is too short", variant: 'info' }); return; }
    if ((targetType === 'property' || targetType === 'tenant') && !targetId) {
      toast({ title: "Select a recipient", variant: 'info' }); return;
    }

    const parts = Math.ceil(message.length / 160);
    const ok = await confirm({
      title: 'Send Bulk SMS',
      message: `Send to ${recipientPreview ? recipientPreview.count : '?'} recipient(s)? Message is ${message.length} chars (${parts} SMS part${parts > 1 ? 's' : ''} each).`,
      confirmLabel: 'Send Now',
      variant: 'info',
    });
    if (!ok) return;

    setSending(true); setBlastResult(null);
    try {
      const res = await apiClient.post<{ data: { sent: number; failed: number; skipped: number } }>(
        '/sms/blasts',
        { subject, message, target_type: targetType, target_id: targetId || undefined }
      );
      setBlastResult(res.data.data);
      toast({ title: `Sent ${res.data.data.sent} messages`, variant: 'success' });
      qc.invalidateQueries({ queryKey: ['sms-blasts'] });
      qc.invalidateQueries({ queryKey: ['sms-usage'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      setSubject(`SMS Blast — ${new Date().toLocaleDateString('en-KE', { month: 'long', year: 'numeric' })}`);
      setMessage('');
    } catch (e) { toast({ title: getApiErrorMessage(e), variant: 'error' }); }
    finally { setSending(false); }
  }

  // ── Request quota increase ──
  async function requestQuota() {
    if (!quotaReq || Number(quotaReq) < 100) { toast({ title: "Enter a valid quota amount", variant: 'info' }); return; }
    if (!quotaReason.trim() || quotaReason.length < 10) { toast({ title: "Provide a reason (min 10 chars)", variant: 'info' }); return; }
    setSubmittingQuota(true);
    try {
      await apiClient.post('/sms/quota-request', { requested_quota: Number(quotaReq), reason: quotaReason });
      toast({ title: "Quota increase request submitted. Our team will review it shortly.", variant: 'success' });
      setQuotaReq(''); setQuotaReason('');
    } catch (e) { toast({ title: getApiErrorMessage(e), variant: 'error' }); }
    finally { setSubmittingQuota(false); }
  }

  async function submitSenderId() {
    if (!senderForm.senderId.trim() || !senderForm.atUsername.trim() || !senderForm.atApiKey.trim()) {
      toast({ title: 'Please fill in Sender ID, AT Username and AT API Key', variant: 'error' }); return;
    }
    setSubmittingSender(true);
    try {
      await apiClient.post('/sms/sender-id-request', {
        senderId:   senderForm.senderId.trim().toUpperCase(),
        atUsername: senderForm.atUsername.trim(),
        atApiKey:   senderForm.atApiKey.trim(),
        reason:     senderForm.reason.trim() || undefined,
      });
      toast({ title: 'Sender ID request submitted! We\'ll review it within 1 business day.', variant: 'success' });
      setSenderForm({ senderId: '', atUsername: '', atApiKey: '', reason: '' });
      refetchSender();
    } catch (e: any) {
      toast({ title: getApiErrorMessage(e), variant: 'error' });
    }
    setSubmittingSender(false);
  }

  const C = 'bg-white rounded-2xl border border-gray-100 shadow-sm';
  const quota = usageData?.company?.sms_quota_monthly ?? 500;
  const used  = usageData?.company?.sms_used_this_month ?? 0;
  const pct   = Math.min(100, Math.round((used / quota) * 100));

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">SMS</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage templates, send bulk messages and track usage</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit">
        {([
          { k: 'blast',     label: '📤 Send SMS' },
          { k: 'templates', label: '✏️ Templates' },
          { k: 'usage',     label: '📊 Usage' },
        ] as const).map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition
              ${tab === t.k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── SEND SMS TAB ── */}
      {tab === 'blast' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Compose */}
          <div className={`${C} p-6`}>
            <h2 className="text-base font-semibold text-gray-900 mb-5">Compose Message</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Subject / Label <span className="text-gray-400 font-normal">(internal only)</span></label>
                <input value={subject} onChange={e => setSubject(e.target.value)}
                  placeholder="e.g. March rent increase notice"
                  className={inputCls} />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Send To</label>
                <div className="flex gap-2 mb-2">
                  {([
                    { v: 'all',      label: '👥 All tenants' },
                    { v: 'property', label: '🏢 Property' },
                    { v: 'tenant',   label: '👤 Specific tenant' },
                  ] as const).map(o => (
                    <button key={o.v} onClick={() => { setTargetType(o.v); setTargetId(''); }}
                      className={`flex-1 py-2 rounded-xl text-xs font-medium border transition
                        ${targetType === o.v ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                      {o.label}
                    </button>
                  ))}
                </div>

                {targetType === 'property' && (
                  <select value={targetId} onChange={e => setTargetId(e.target.value)} className={inputCls}>
                    <option value="">Select property…</option>
                    {(properties ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}

                {targetType === 'tenant' && (
                  <select value={targetId} onChange={e => setTargetId(e.target.value)} className={inputCls}>
                    <option value="">Select tenant…</option>
                    {(tenants ?? []).map(t => (
                      <option key={t.id} value={t.id}>{t.full_name} — Unit {t.unit_number}, {t.property_name}</option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700">Message</label>
                  <span className={`text-xs ${message.length > 320 ? 'text-red-500' : 'text-gray-400'}`}>
                    {message.length}/320 · {Math.ceil(message.length / 160) || 1} SMS part{Math.ceil(message.length / 160) > 1 ? 's' : ''}
                  </span>
                </div>
                <textarea value={message} onChange={e => setMessage(e.target.value)} rows={5}
                  placeholder="Type your message… You can use {tenant_name} to personalise."
                  className={inputCls + ' resize-none'} />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {['{tenant_name}','{unit}','{property}','{amount}','{month}'].map(p => (
                    <button key={p} onClick={() => setMessage(m => m + p)}
                      className="px-2 py-0.5 rounded-md bg-teal-50 text-teal-700 text-xs font-mono hover:bg-teal-100 transition">
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <button onClick={loadRecipientPreview} disabled={loadingPreview || (targetType !== 'all' && !targetId)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 transition disabled:opacity-40 disabled:cursor-not-allowed">
                  {loadingPreview ? 'Loading…' : '👁 Preview recipients'}
                </button>
                <button onClick={sendBlast}
                  disabled={sending || !message.trim() || message.length > 320 || (targetType !== 'all' && !targetId)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: '#0d9f9f' }}>
                  {sending ? 'Sending…' : '📤 Send SMS'}
                </button>
              </div>
              {!message.trim() && (
                <p className="text-xs text-gray-400 text-center">Type a message above to enable sending</p>
              )}
              {message.trim() && targetType !== 'all' && !targetId && (
                <p className="text-xs text-amber-500 text-center">Select a recipient above to enable sending</p>
              )}
            </div>

            {blastResult && (
              <div className="mt-4 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
                ✅ Done — <strong>{blastResult.sent}</strong> sent · <strong>{blastResult.failed}</strong> failed · <strong>{blastResult.skipped}</strong> skipped
              </div>
            )}
          </div>

          {/* Right column */}
          <div className="space-y-4">
            {/* Recipient preview */}
            {recipientPreview && (
              <div className={`${C} p-5`}>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">
                  Recipients ({recipientPreview.count})
                </h3>
                {recipientPreview.count === 0 ? (
                  <p className="text-sm text-red-500">No eligible recipients. Check phone numbers are set and SMS is enabled.</p>
                ) : (
                  <div className="divide-y divide-gray-50 max-h-48 overflow-y-auto">
                    {recipientPreview.recipients.map((r, i) => (
                      <div key={i} className="py-2 flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-teal-50 flex items-center justify-center text-xs font-bold text-teal-700 shrink-0">
                          {r.full_name?.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-gray-800 truncate">{r.full_name}</p>
                          <p className="text-xs text-gray-400">Unit {r.unit_number} · {r.phone}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Blast history */}
            <div className={`${C} p-5`}>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Recent Blasts</h3>
              {!(blastData?.length) ? (
                <p className="text-xs text-gray-400 text-center py-4">No blasts yet</p>
              ) : (
                <div className="space-y-2">
                  {(blastData ?? []).slice(0, 8).map(b => (
                    <div key={b.id} className="flex items-start gap-3 p-3 rounded-xl bg-gray-50">
                      <span className="text-lg shrink-0">
                        {b.target_type === 'all' ? '👥' : b.target_type === 'property' ? '🏢' : '👤'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{b.subject}</p>
                        <p className="text-xs text-gray-500">{b.target_label} · {b.total_sent} sent · {b.total_failed} failed</p>
                        <p className="text-xs text-gray-400">{DATE(b.created_at)}</p>
                      </div>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0
                        ${b.status === 'done' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-600'}`}>
                        {b.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── TEMPLATES TAB ── */}
      {tab === 'templates' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Template list */}
          <div className="space-y-3">
            {(tplData?.templates ?? []).map(tpl => {
              const meta = TEMPLATE_LABELS[tpl.type] ?? { label: tpl.type, icon: '📝', desc: '' };
              return (
                <div key={tpl.type} className={`${C} p-4`}>
                  <div className="flex items-start gap-3">
                    <span className="text-2xl shrink-0">{meta.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-sm font-semibold text-gray-900">{tpl.name}</p>
                        {!tpl.is_active && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Inactive</span>}
                      </div>
                      <p className="text-xs text-gray-400 mb-2">{meta.desc}</p>
                      <p className="text-xs text-gray-600 bg-gray-50 rounded-lg p-2 line-clamp-3 font-mono leading-relaxed">{tpl.template}</p>
                    </div>
                  </div>
                  <div className="flex justify-end mt-3">
                    <button onClick={() => startEdit(tpl)}
                      className="px-3 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100 transition">
                      ✏️ Edit
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Editor */}
          {editingType ? (
            <div className={`${C} p-6 h-fit sticky top-4`}>
              <h3 className="text-base font-semibold text-gray-900 mb-4">
                Edit: {TEMPLATE_LABELS[editingType]?.label ?? editingType}
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Template Name</label>
                  <input value={editName} onChange={e => setEditName(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-medium text-gray-700">Message Template</label>
                    <span className={`text-xs ${editText.length > 320 ? 'text-red-500' : 'text-gray-400'}`}>
                      {editText.length}/320
                    </span>
                  </div>
                  <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={6}
                    className={inputCls + ' resize-none font-mono text-xs leading-relaxed'} />
                </div>

                {/* Placeholders */}
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">Available placeholders:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {PLACEHOLDERS.map(p => (
                      <button key={p.key} onClick={() => setEditText(t => t + p.key)}
                        title={p.desc}
                        className="px-2 py-0.5 rounded-md bg-teal-50 text-teal-700 text-xs font-mono hover:bg-teal-100 transition">
                        {p.key}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Preview */}
                {preview && (
                  <div className="p-3 rounded-xl bg-blue-50 border border-blue-100">
                    <p className="text-xs font-medium text-blue-700 mb-1">Preview (with sample data):</p>
                    <p className="text-xs text-blue-800 leading-relaxed">{preview}</p>
                    <p className="text-xs text-blue-500 mt-1">{preview.length} chars · {Math.ceil(preview.length / 160)} SMS part{Math.ceil(preview.length / 160) > 1 ? 's' : ''}</p>
                  </div>
                )}

                <div className="flex gap-2">
                  <button onClick={previewTemplate}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 transition">
                    👁 Preview
                  </button>
                  <button onClick={saveTemplate} disabled={savingTpl}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition"
                    style={{ background: '#0d9f9f' }}>
                    {savingTpl ? 'Saving…' : 'Save Template'}
                  </button>
                </div>
                <button onClick={() => setEditingType(null)}
                  className="w-full py-2 text-sm text-gray-400 hover:text-gray-600 transition">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center text-center text-gray-400 py-20">
              <div>
                <p className="text-4xl mb-2">✏️</p>
                <p className="text-sm">Click Edit on a template to customise it</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── USAGE TAB ── */}
      {tab === 'usage' && (
        <div className="space-y-6">
          {/* Quota bar */}
          <div className={`${C} p-6`}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-900">Monthly SMS Quota</h2>
              <span className={`text-sm font-bold ${pct >= 90 ? 'text-red-600' : pct >= 70 ? 'text-amber-600' : 'text-teal-600'}`}>
                {used} / {quota} used
              </span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-3 mb-2">
              <div className="h-3 rounded-full transition-all"
                style={{
                  width: `${pct}%`,
                  background: pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#0d9f9f',
                }} />
            </div>
            <div className="flex justify-between text-xs text-gray-400">
              <span>{quota - used} remaining this month</span>
              <span>{pct}% used</span>
            </div>
            {usageData?.company?.at_sender_id ? (
              <div className="mt-3 flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 px-3 py-2 rounded-xl">
                ✅ Using your approved sender ID: <span className="font-mono font-bold">{usageData.company.at_sender_id}</span>
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 px-3 py-2 rounded-xl">
                ⏳ Using shared sender ID <span className="font-mono font-bold">AFRICASTKNG</span> until yours is approved
              </div>
            )}
          </div>

          {/* This month stats */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Sent this month',   value: usageData?.monthStats.total_sent   ?? 0, color: '#10b981' },
              { label: 'Successful',         value: usageData?.monthStats.successful   ?? 0, color: '#0d9f9f' },
              { label: 'Failed',             value: usageData?.monthStats.failed       ?? 0, color: '#ef4444' },
              { label: 'Est. Cost',          value: `KES ${Number(usageData?.monthStats.total_cost ?? 0).toFixed(2)}`, color: '#6b7280', raw: true },
            ].map(s => (
              <div key={s.label} className={`${C} p-4`}>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{s.label}</p>
                <p className="text-2xl font-bold" style={{ color: s.color }}>
                  {(s as any).raw ? s.value : Number(s.value).toLocaleString()}
                </p>
              </div>
            ))}
          </div>

          {/* 6-month history */}
          <div className={`${C} p-6`}>
            <h2 className="text-base font-semibold text-gray-900 mb-4">6-Month History</h2>
            {!(usageData?.history?.length) ? (
              <p className="text-sm text-gray-400 text-center py-8">No history yet</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100">
                      <th className="pb-3 pr-6">Month</th>
                      <th className="pb-3 pr-6">Sent</th>
                      <th className="pb-3 pr-6">Failed</th>
                      <th className="pb-3">SMS Parts</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {usageData.history.map(h => (
                      <tr key={h.month}>
                        <td className="py-3 pr-6 font-medium text-gray-800">{h.month}</td>
                        <td className="py-3 pr-6 text-emerald-600 font-semibold">{Number(h.sent).toLocaleString()}</td>
                        <td className="py-3 pr-6 text-red-500">{Number(h.failed).toLocaleString()}</td>
                        <td className="py-3 text-gray-500">{Number(h.parts).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Request quota increase */}
          <div className={`${C} p-6`}>
            <h2 className="text-base font-semibold text-gray-900 mb-1">Request Quota Increase</h2>
            <p className="text-sm text-gray-500 mb-5">Need more than {quota} SMS/month? Submit a request and we'll get back to you.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Requested Monthly Quota</label>
                <input type="number" value={quotaReq} onChange={e => setQuotaReq(e.target.value)}
                  placeholder="e.g. 2000" min={100} className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                <textarea value={quotaReason} onChange={e => setQuotaReason(e.target.value)} rows={3}
                  placeholder="Explain why you need more SMS quota…"
                  className={inputCls + ' resize-none'} />
              </div>
              <div className="sm:col-span-2">
                <button onClick={requestQuota} disabled={submittingQuota}
                  className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition"
                  style={{ background: '#0d9f9f' }}>
                  {submittingQuota ? 'Submitting…' : 'Submit Request'}
                </button>
              </div>
            </div>
          </div>

          {/* Custom Sender ID */}
          <div className={`${C} p-6`}>
            <h2 className="text-base font-semibold text-gray-900 mb-1">Custom Sender ID</h2>
            <p className="text-sm text-gray-500 mb-5">
              Use your own branded sender name (e.g. <span className="font-mono font-semibold">WESTGATE</span>) instead of the shared <span className="font-mono">AFRICASTKNG</span>.
            </p>

            {/* Status badge when request exists */}
            {senderStatus && (() => {
              const STATUS: Record<string, { label: string; bg: string; border: string; color: string; icon: string }> = {
                pending:  { label: 'Under Review',  bg: '#fef3c7', border: '#fcd34d', color: '#92400e', icon: '⏳' },
                approved: { label: 'Approved',      bg: '#f0fdf4', border: '#86efac', color: '#166534', icon: '✅' },
                rejected: { label: 'Rejected',      bg: '#fef2f2', border: '#fca5a5', color: '#991b1b', icon: '❌' },
              };
              const s = STATUS[senderStatus.status] ?? STATUS.pending;
              return (
                <div className="rounded-xl border p-4 mb-5 flex items-start gap-3"
                  style={{ background: s.bg, borderColor: s.border }}>
                  <span className="text-xl mt-0.5">{s.icon}</span>
                  <div className="flex-1">
                    <p className="font-bold text-sm" style={{ color: s.color }}>
                      Request {s.label}
                    </p>
                    <p className="text-sm text-gray-600 mt-0.5">
                      Sender ID: <span className="font-mono font-bold">{senderStatus.sender_id}</span>
                      {' · '}
                      Submitted {new Date(senderStatus.created_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                    {senderStatus.status === 'approved' && (
                      <p className="text-sm font-medium mt-1" style={{ color: '#166534' }}>
                        All SMS from your account now use <span className="font-mono font-bold">{senderStatus.sender_id}</span> as the sender name.
                      </p>
                    )}
                    {senderStatus.status === 'rejected' && senderStatus.rejection_note && (
                      <p className="text-sm mt-1" style={{ color: '#991b1b' }}>
                        Reason: {senderStatus.rejection_note}
                      </p>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Show form only when no pending/approved request */}
            {(!senderStatus || senderStatus.status === 'rejected') && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Sender ID <span className="text-gray-400 font-normal">(max 11 chars)</span>
                    </label>
                    <input
                      value={senderForm.senderId}
                      onChange={e => setSenderForm(f => ({ ...f, senderId: e.target.value.toUpperCase() }))}
                      placeholder="e.g. WESTGATE"
                      maxLength={11}
                      className={inputCls + ' font-mono tracking-widest'}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">AT Username</label>
                    <input
                      value={senderForm.atUsername}
                      onChange={e => setSenderForm(f => ({ ...f, atUsername: e.target.value }))}
                      placeholder="Your Africa's Talking username"
                      className={inputCls}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">AT API Key</label>
                    <input
                      type="password"
                      value={senderForm.atApiKey}
                      onChange={e => setSenderForm(f => ({ ...f, atApiKey: e.target.value }))}
                      placeholder="Your Africa's Talking API key"
                      className={inputCls}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Reason <span className="text-gray-400 font-normal">(optional)</span>
                    </label>
                    <input
                      value={senderForm.reason}
                      onChange={e => setSenderForm(f => ({ ...f, reason: e.target.value }))}
                      placeholder="e.g. Brand recognition for 200+ tenants"
                      className={inputCls}
                    />
                  </div>
                </div>

                {/* Steps */}
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
                  <p className="font-semibold mb-2">📋 How to apply — 3 steps:</p>
                  <ol className="list-decimal list-inside space-y-1.5">
                    <li>Gather the documents listed below and register at <strong>account.africastalking.com</strong></li>
                    <li>Request your Sender ID on the AT dashboard — approval takes <strong>2–5 business days</strong></li>
                    <li>Once AT approves it, come back here and submit — we'll activate it within 1 business day</li>
                  </ol>
                </div>

                {/* Required documents */}
                <div className="rounded-xl border border-gray-200 overflow-hidden text-xs">
                  <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200">
                    <p className="font-semibold text-gray-700">Required documents for Africa's Talking</p>
                  </div>
                  <div className="divide-y divide-gray-100">

                    {/* Company owner */}
                    <div className="px-4 py-3">
                      <p className="font-semibold text-gray-700 mb-1.5">If the owner is a company</p>
                      <ul className="space-y-1 text-gray-600">
                        <li className="flex items-start gap-2"><span className="text-teal-500 shrink-0 mt-0.5">•</span>Certificate of Registration / Incorporation</li>
                        <li className="flex items-start gap-2"><span className="text-teal-500 shrink-0 mt-0.5">•</span>Tax registration document (e.g. KRA PIN certificate)</li>
                        <li className="flex items-start gap-2"><span className="text-teal-500 shrink-0 mt-0.5">•</span>National ID or passport of an authorised company representative</li>
                      </ul>
                    </div>

                    {/* Individual owner */}
                    <div className="px-4 py-3">
                      <p className="font-semibold text-gray-700 mb-1.5">If the owner is an individual</p>
                      <ul className="space-y-1 text-gray-600">
                        <li className="flex items-start gap-2"><span className="text-teal-500 shrink-0 mt-0.5">•</span>National ID or passport</li>
                        <li className="flex items-start gap-2"><span className="text-teal-500 shrink-0 mt-0.5">•</span>Tax registration document (e.g. KRA PIN certificate)</li>
                      </ul>
                    </div>

                    {/* Supporting docs */}
                    <div className="px-4 py-3 bg-gray-50">
                      <p className="font-semibold text-gray-700 mb-1.5">Other supporting documents <span className="font-normal text-gray-400">(as applicable)</span></p>
                      <ul className="space-y-1 text-gray-600">
                        <li className="flex items-start gap-2"><span className="text-teal-500 shrink-0 mt-0.5">•</span>Letter of Authorisation (if applying on behalf of another entity)</li>
                        <li className="flex items-start gap-2"><span className="text-teal-500 shrink-0 mt-0.5">•</span>Service description and sample message flows <span className="text-gray-400">(for telco approval)</span></li>
                        <li className="flex items-start gap-2"><span className="text-teal-500 shrink-0 mt-0.5">•</span>Any regulator-specific forms required in your jurisdiction</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <button
                  onClick={submitSenderId}
                  disabled={submittingSender}
                  className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition"
                  style={{ background: 'linear-gradient(135deg,#0d9f9f,#076666)' }}>
                  {submittingSender ? 'Submitting…' : 'Submit Sender ID Request'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}