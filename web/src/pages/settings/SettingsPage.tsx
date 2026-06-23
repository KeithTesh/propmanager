// web/src/pages/settings/SettingsPage.tsx

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, getApiErrorMessage } from '../../lib/api';
import { toast } from '../../components/ui/toaster';
import { useAuthStore } from '../../stores/authStore';
import { PasswordInput } from '../../components/ui/PasswordInput';

interface Company {
  id: string; name: string; trading_name: string | null;
  phone: string; email: string; address: string | null; county: string | null;
  registration_number: string | null; kra_pin: string | null;
  payment_method: string; paybill_number: string | null;
  paybill_account_format: string | null;
  bank_name: string | null; bank_account_number: string | null; bank_branch: string | null;
  move_in_proration_mode: string | null; move_in_proration_cutoff: number | null;
  move_in_proration_method: string | null; move_out_proration_mode: string | null;
  bill_first_partial_month: boolean; min_proration_threshold: number;
  due_day: number; grace_period_days: number;
  penalty_type: string; penalty_value: string; penalty_applies_after_days: number;
}

const inputCls = "w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition placeholder-gray-400";
const selectCls = inputCls + " bg-white";

function Section({ title, description, children }: {
  title: string; description?: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {description && <p className="text-xs text-gray-400 mt-0.5">{description}</p>}
      </div>
      <div className="p-6 space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>;
}

export default function SettingsPage() {
  const { company: authCompany } = useAuthStore();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'profile'|'billing'|'proration'|'sms'|'password'|'subscription'>('profile');
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [error,   setError]   = useState('');

  const { data: company, isLoading } = useQuery({
    queryKey: ['company-settings'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { company: Company } }>(`/companies/${authCompany?.id}`);
      return res.data.data.company;
    },
    enabled: !!authCompany?.id,
  });

  // Form state — profile
  const [profile, setProfile] = useState({ name:'', tradingName:'', phone:'', email:'', address:'', county:'', registrationNumber:'', kraPin:'' });
  // Form state — payment
  const [payment, setPayment] = useState({ paymentMethod:'cash', paybillNumber:'', paybillAccountFormat:'', bankName:'', bankAccountNumber:'', bankBranch:'' });
  const [accountFormatMode, setAccountFormatMode] = useState<'system'|'bank'>('system');
  const [regenerating, setRegenerating] = useState(false);
  // Form state — billing
  const [billing, setBilling] = useState({ dueDay:'1', gracePeriodDays:'0', penaltyType:'none', penaltyValue:'0', penaltyAppliesAfterDays:'0' });
  // Form state — proration
  const [proration, setProration] = useState({ moveInProrationMode:'never', moveInProrationCutoff:'15', moveInProrationMethod:'actual_days', moveOutProrationMode:'full_month', billFirstPartialMonth: true, minProrationThreshold:'500' });
  // Password
  const [passwords, setPasswords] = useState({ current:'', newPass:'', confirm:'' });

  useEffect(() => {
    if (!company) return;
    setProfile({
      name: company.name ?? '', tradingName: company.trading_name ?? '',
      phone: company.phone ?? '', email: company.email ?? '',
      address: company.address ?? '', county: company.county ?? '',
      registrationNumber: company.registration_number ?? '', kraPin: company.kra_pin ?? '',
    });
    setPayment({
      paymentMethod: company.payment_method ?? 'cash',
      paybillNumber: company.paybill_number ?? '',
      paybillAccountFormat: company.paybill_account_format ?? '',
      bankName: company.bank_name ?? '',
      bankAccountNumber: company.bank_account_number ?? '',
      bankBranch: company.bank_branch ?? '',
    });
    setBilling({
      dueDay: String(company.due_day ?? 1),
      gracePeriodDays: String(company.grace_period_days ?? 0),
      penaltyType: company.penalty_type ?? 'none',
      penaltyValue: String(company.penalty_value ?? 0),
      penaltyAppliesAfterDays: String(company.penalty_applies_after_days ?? 0),
    });
    setProration({
      moveInProrationMode: company.move_in_proration_mode ?? 'never',
      moveInProrationCutoff: String(company.move_in_proration_cutoff ?? 15),
      moveInProrationMethod: company.move_in_proration_method ?? 'actual_days',
      moveOutProrationMode: company.move_out_proration_mode ?? 'full_month',
      billFirstPartialMonth: company.bill_first_partial_month ?? true,
      minProrationThreshold: String(company.min_proration_threshold ?? 500),
    });
  }, [company]);

  async function save(payload: Record<string, unknown>) {
    if (!authCompany?.id) return;
    setSaving(true); setError(''); setSaved(false);
    try {
      await apiClient.patch(`/companies/${authCompany.id}/settings`, payload);
      qc.invalidateQueries({ queryKey: ['company-settings'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) { setError(getApiErrorMessage(e)); }
    finally { setSaving(false); }
  }

  async function savePassword() {
    if (!passwords.newPass) { setError('Enter a new password'); return; }
    if (passwords.newPass !== passwords.confirm) { setError('Passwords do not match'); return; }
    if (passwords.newPass.length < 8) { setError('Password must be at least 8 characters'); return; }
    setSaving(true); setError(''); setSaved(false);
    try {
      await apiClient.post('/auth/change-password', { currentPassword: passwords.current, newPassword: passwords.newPass });
      setPasswords({ current:'', newPass:'', confirm:'' });
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } catch (e) { setError(getApiErrorMessage(e)); }
    finally { setSaving(false); }
  }

  const tabs = [
    { k: 'profile',   label: 'Company Profile' },
    { k: 'billing',   label: 'Billing & Payments' },
    { k: 'proration', label: 'Proration Rules' },
    { k: 'password',    label: 'Password' },
    { k: 'subscription', label: '💳 Subscription' },
  ] as const;

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor:'#0d9f9f', borderTopColor:'transparent' }} />
    </div>
  );

  async function regenerateAccountRefs(mode: 'system' | 'bank') {
    setRegenerating(true);
    try {
      await apiClient.post(`/companies/${authCompany?.id}/regenerate-account-refs`, { mode });
      qc.invalidateQueries({ queryKey: ['company-settings'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) { setError(getApiErrorMessage(e)); }
    finally { setRegenerating(false); }
  }

  return (
    <div className="p-6 lg:p-8 ">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your company configuration</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.k} onClick={() => { setActiveTab(t.k); setError(''); setSaved(false); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap
              ${activeTab === t.k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Status messages */}
      {error && <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
      {saved && <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-700 flex items-center gap-2">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
        Changes saved successfully
      </div>}

      {/* ── Profile ── */}
      {activeTab === 'profile' && (
        <div className="space-y-5">
          <Section title="Company Details" description="Basic company information">
            <Row>
              <Field label="Company Name *">
                <input value={profile.name} onChange={e => setProfile(p => ({...p, name: e.target.value}))} className={inputCls} />
              </Field>
              <Field label="Trading Name">
                <input value={profile.tradingName} onChange={e => setProfile(p => ({...p, tradingName: e.target.value}))} placeholder="If different from legal name" className={inputCls} />
              </Field>
            </Row>
            <Row>
              <Field label="Phone *">
                <input value={profile.phone} onChange={e => setProfile(p => ({...p, phone: e.target.value}))} className={inputCls} />
              </Field>
              <Field label="Email *">
                <input type="email" value={profile.email} onChange={e => setProfile(p => ({...p, email: e.target.value}))} className={inputCls} />
              </Field>
            </Row>
            <Row>
              <Field label="County">
                <input value={profile.county} onChange={e => setProfile(p => ({...p, county: e.target.value}))} placeholder="Nairobi" className={inputCls} />
              </Field>
              <Field label="Address">
                <input value={profile.address} onChange={e => setProfile(p => ({...p, address: e.target.value}))} placeholder="P.O. Box 12345" className={inputCls} />
              </Field>
            </Row>
            <Row>
              <Field label="Registration Number">
                <input value={profile.registrationNumber} onChange={e => setProfile(p => ({...p, registrationNumber: e.target.value}))} className={inputCls} />
              </Field>
              <Field label="KRA PIN">
                <input value={profile.kraPin} onChange={e => setProfile(p => ({...p, kraPin: e.target.value}))} className={inputCls} />
              </Field>
            </Row>
          </Section>
          <div className="flex justify-end">
            <button onClick={() => save({ ...profile })} disabled={saving}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60 flex items-center gap-2 transition"
              style={{ background: '#0d9f9f' }}>
              {saving && <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
              Save Profile
            </button>
          </div>
        </div>
      )}

      {/* ── Billing & Payments ── */}
      {activeTab === 'billing' && (
        <div className="space-y-5">
          <Section title="Payment Method" description="How tenants pay rent">
            <Field label="Payment Channel">
              <select value={payment.paymentMethod} onChange={e => setPayment(p => ({...p, paymentMethod: e.target.value}))} className={selectCls}>
                <option value="cash">Cash</option>
                <option value="bank_paybill">Bank / M-Pesa PayBill</option>
                <option value="manual">Manual</option>
              </select>
            </Field>
            {payment.paymentMethod === 'bank_paybill' && (
              <>
                <Row>
                  <Field label="PayBill Number">
                    <input value={payment.paybillNumber} onChange={e => setPayment(p => ({...p, paybillNumber: e.target.value}))} placeholder="123456" className={inputCls} />
                  </Field>
                  <Field label="Account Reference Format" hint="Determines how tenants identify their payment on M-Pesa">
                    <select
                      value={accountFormatMode}
                      onChange={e => {
                        setAccountFormatMode(e.target.value as 'system' | 'bank');
                      }}
                      className={selectCls}>
                      <option value="system">System generated (e.g. A1-ABC123)</option>
                      <option value="bank">Bank account number</option>
                    </select>
                    <p className="text-xs text-gray-400 mt-1">Currently using: <strong>{accountFormatMode === 'bank' ? 'Bank account number' : 'System generated (e.g. A1-ABC123)'}</strong></p>
                    {regenerating && <p className="text-xs text-teal-600 mt-1">⟳ Updating all lease references…</p>}
                    {accountFormatMode === 'bank' && !payment.bankAccountNumber && (
                      <p className="text-xs text-amber-600 mt-1">⚠️ Enter your bank account number below first</p>
                    )}
                  </Field>
                </Row>
                <Row>
                  <Field label="Bank Name">
                    <input value={payment.bankName} onChange={e => setPayment(p => ({...p, bankName: e.target.value}))} placeholder="KCB, Equity…" className={inputCls} />
                  </Field>
                  <Field label="Account Number">
                    <input value={payment.bankAccountNumber} onChange={e => setPayment(p => ({...p, bankAccountNumber: e.target.value}))} className={inputCls} />
                  </Field>
                </Row>
              </>
            )}
          </Section>

          <Section title="Billing Schedule" description="When bills are generated and when they're due">
            <Row>
              <Field label="Bill Due Day" hint="Day of month rent is due (1–28)">
                <input type="number" min={1} max={28} value={billing.dueDay}
                  onChange={e => setBilling(b => ({...b, dueDay: e.target.value}))} className={inputCls} />
              </Field>
              <Field label="Grace Period (days)" hint="Days after due date before bill becomes overdue">
                <input type="number" min={0} value={billing.gracePeriodDays}
                  onChange={e => setBilling(b => ({...b, gracePeriodDays: e.target.value}))} className={inputCls} />
              </Field>
            </Row>
          </Section>

          <Section title="Late Payment Penalty" description="Automatically charge tenants who pay late">
            <Field label="Penalty Type">
              <select value={billing.penaltyType} onChange={e => setBilling(b => ({...b, penaltyType: e.target.value}))} className={selectCls}>
                <option value="none">No penalty</option>
                <option value="flat">Flat amount (KES)</option>
                <option value="percentage">Percentage of rent (%)</option>
              </select>
            </Field>
            {billing.penaltyType !== 'none' && (
              <Row>
                <Field label={billing.penaltyType === 'flat' ? 'Penalty Amount (KES)' : 'Penalty Rate (%)'}>
                  <input type="number" min={0} value={billing.penaltyValue}
                    onChange={e => setBilling(b => ({...b, penaltyValue: e.target.value}))} className={inputCls} />
                </Field>
                <Field label="Apply after (days overdue)">
                  <input type="number" min={0} value={billing.penaltyAppliesAfterDays}
                    onChange={e => setBilling(b => ({...b, penaltyAppliesAfterDays: e.target.value}))} className={inputCls} />
                </Field>
              </Row>
            )}
          </Section>

          <div className="flex justify-end">
            <button onClick={async () => {
              await save({
                paymentMethod: payment.paymentMethod,
                paybillNumber: payment.paybillNumber || null,
                paybillAccountFormat: payment.paybillAccountFormat || null,
                bankName: payment.bankName || null,
                bankAccountNumber: payment.bankAccountNumber || null,
                bankBranch: payment.bankBranch || null,
                dueDay: parseInt(billing.dueDay),
                gracePeriodDays: parseInt(billing.gracePeriodDays),
                penaltyType: billing.penaltyType,
                penaltyValue: parseFloat(billing.penaltyValue),
                penaltyAppliesAfterDays: parseInt(billing.penaltyAppliesAfterDays),
              });
              await regenerateAccountRefs(accountFormatMode);
            }} disabled={saving || regenerating}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60 flex items-center gap-2 transition"
              style={{ background: '#0d9f9f' }}>
              {saving && <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
              {regenerating ? '⟳ Updating references…' : 'Save Billing Config'}
            </button>
          </div>
        </div>
      )}

      {/* ── Proration ── */}
      {activeTab === 'proration' && (
        <div className="space-y-5">
          <Section title="Move-In Proration" description="How partial first months are billed when a tenant moves in mid-month">
            <Field label="Proration Mode">
              <select value={proration.moveInProrationMode} onChange={e => setProration(p => ({...p, moveInProrationMode: e.target.value}))} className={selectCls}>
                <option value="always">Always prorate partial months</option>
                <option value="after_cutoff">Prorate only after cutoff day</option>
                <option value="never">Always charge full month</option>
              </select>
            </Field>
            {proration.moveInProrationMode === 'after_cutoff' && (
              <Field label="Cutoff Day" hint="Prorate only if tenant moves in after this day of month">
                <input type="number" min={1} max={28} value={proration.moveInProrationCutoff}
                  onChange={e => setProration(p => ({...p, moveInProrationCutoff: e.target.value}))} className={inputCls} />
              </Field>
            )}
            {proration.moveInProrationMode !== 'never' && (
              <>
                <Field label="Proration Method">
                  <select value={proration.moveInProrationMethod} onChange={e => setProration(p => ({...p, moveInProrationMethod: e.target.value}))} className={selectCls}>
                    <option value="actual_days">Actual days in month (e.g. Feb = 28 days)</option>
                    <option value="standard_30">Standard 30-day month</option>
                  </select>
                </Field>
                <Field label="Minimum Proration Threshold (KES)" hint="If prorated amount is below this, charge full month instead">
                  <input type="number" min={0} value={proration.minProrationThreshold}
                    onChange={e => setProration(p => ({...p, minProrationThreshold: e.target.value}))} className={inputCls} />
                </Field>
              </>
            )}
            <label className="flex items-center gap-3 p-3.5 rounded-xl border border-gray-200 cursor-pointer hover:bg-gray-50 transition">
              <input type="checkbox" checked={proration.billFirstPartialMonth}
                onChange={e => setProration(p => ({...p, billFirstPartialMonth: e.target.checked}))}
                className="w-4 h-4 accent-teal-500" />
              <div>
                <p className="text-sm font-medium text-gray-800">Generate signing bill for first partial month</p>
                <p className="text-xs text-gray-400 mt-0.5">Collect first month rent at signing alongside deposit</p>
              </div>
            </label>
          </Section>

          <Section title="Move-Out Proration" description="How the final month is charged when a tenant vacates">
            <Field label="Move-Out Mode">
              <select value={proration.moveOutProrationMode} onChange={e => setProration(p => ({...p, moveOutProrationMode: e.target.value}))} className={selectCls}>
                <option value="full_month">Always charge full final month</option>
                <option value="to_notice_date">Prorate to stated move-out date</option>
                <option value="to_actual_date">Prorate to actual vacate date</option>
              </select>
            </Field>
          </Section>

          <div className="flex justify-end">
            <button onClick={() => save({
              moveInProrationMode: proration.moveInProrationMode || null,
              moveInProrationCutoff: proration.moveInProrationMode === 'after_cutoff' ? parseInt(proration.moveInProrationCutoff) : null,
              moveInProrationMethod: proration.moveInProrationMethod || null,
              moveOutProrationMode: proration.moveOutProrationMode || null,
              billFirstPartialMonth: proration.billFirstPartialMonth,
              minProrationThreshold: parseInt(proration.minProrationThreshold),
            })} disabled={saving}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60 flex items-center gap-2 transition"
              style={{ background: '#0d9f9f' }}>
              {saving && <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
              Save Proration Rules
            </button>
          </div>
        </div>
      )}

      {/* ── Password ── */}

      {activeTab === 'sms' && <SmsSettingsTab />}

      {activeTab === 'subscription' && <SubscriptionTab />}

      {activeTab === 'password' && (
        <div className="space-y-5">
          <Section title="Change Password">
            <Field label="Current Password">
              <PasswordInput value={passwords.current}
                onChange={e => setPasswords(p => ({...p, current: e.target.value}))} className={inputCls} />
            </Field>
            <Field label="New Password">
              <PasswordInput value={passwords.newPass}
                onChange={e => setPasswords(p => ({...p, newPass: e.target.value}))} className={inputCls} />
            </Field>
            <Field label="Confirm New Password">
              <PasswordInput value={passwords.confirm}
                onChange={e => setPasswords(p => ({...p, confirm: e.target.value}))} className={inputCls} />
            </Field>
          </Section>
          <div className="flex justify-end">
            <button onClick={savePassword} disabled={saving}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60 flex items-center gap-2 transition"
              style={{ background: '#0d9f9f' }}>
              {saving && <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
              Update Password
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


// ─── SUBSCRIPTION TAB ─────────────────────────────────────────────────────────
function SubscriptionTab() {
  const qc = useQueryClient();
  const [phone, setPhone] = useState('');
  const [plan, setPlan] = useState<'starter'|'growth'|'enterprise'>('growth');
  const [paying, setPaying] = useState(false);
  const [polling, setPolling] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['sub-status'],
    queryFn: () => apiClient.get('/subscription/status').then((r:any) => r.data.data),
    refetchInterval: polling ? 6000 : 60000,
  });

  const sub = data?.company;
  const trialLeft = data?.trialDaysLeft ?? 0;
  const PLANS = [
    { id:'starter' as const,    name:'Starter',    price:2500,  units:'50' },
    { id:'growth' as const,     name:'Growth',     price:5500,  units:'200' },
    { id:'enterprise' as const, name:'Enterprise', price:12000, units:'∞' },
  ];
  const KES = (n:number) => `KES ${n.toLocaleString('en-KE')}`;
  const DATE = (d:string|null) => d ? new Date(d).toLocaleDateString('en-KE',{day:'numeric',month:'long',year:'numeric'}) : '—';
  const STATUS_CLR:Record<string,string> = { active:'#22c55e', trialing:'#3b82f6', suspended:'#f97316', cancelled:'#ef4444', expired:'#6b7280' };

  async function pay() {
    if (!phone.trim()) { toast({ title: 'Enter your M-Pesa phone number', variant: 'error' }); return; }
    setPaying(true);
    try {
      const r:any = await apiClient.post('/subscription/pay', { plan, phone });
      const pid = r.data.data.paymentId;
      toast({ title: "M-Pesa prompt sent! Enter your PIN to complete.", variant: 'success' });
      setPolling(true);
      let tries = 0;
      const iv = setInterval(async () => {
        tries++;
        try {
          const s:any = await apiClient.get(`/subscription/pay/${pid}/status`);
          const st = s.data.data.payment.status;
          if (st === 'completed') {
            clearInterval(iv); setPolling(false);
            qc.invalidateQueries({ queryKey: ['sub-status'] });
            toast({ title: '✅ Subscription activated!', variant: 'success' });
          } else if (st === 'failed' || tries >= 20) {
            clearInterval(iv); setPolling(false);
            if (st === 'failed') toast({ title: 'Payment failed. Please try again.', variant: 'error' });
            else toast({ title: 'Payment timed out. Check your M-Pesa.', variant: 'error' });
          }
        } catch {}
      }, 6000);
    } catch(e:any) { toast({ title: e?.response?.data?.error?.message || 'Payment failed', variant: 'error' }); }
    setPaying(false);
  }

  if (isLoading) return <div className="p-10 text-center text-gray-400">Loading…</div>;

  return (
    <div className="space-y-5">
      {/* Status card */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Current Plan</p>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3">
              <span className="text-2xl font-extrabold text-gray-900" style={{fontFamily:'Sora,sans-serif'}}>
                {(sub?.plan ?? 'trial').charAt(0).toUpperCase() + (sub?.plan ?? 'trial').slice(1)}
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold"
                style={{ background:(STATUS_CLR[sub?.subscription_status??'']??'#6b7280')+'18', color:STATUS_CLR[sub?.subscription_status??'']??'#6b7280' }}>
                {sub?.subscription_status}
              </span>
            </div>
            {sub?.subscription_status === 'trialing' && (
              <p className={`text-sm mt-1 font-semibold ${trialLeft <= 3 ? 'text-red-500' : 'text-gray-500'}`}>
                {trialLeft === 0 ? '⚠️ Trial expires today' : `⏳ ${trialLeft} day${trialLeft===1?'':'s'} remaining`}
              </p>
            )}
            {sub?.subscription_status === 'active' && (
              <p className="text-sm text-gray-500 mt-1">Next billing: {DATE(sub.next_billing_at)}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">Units used</p>
            <p className="text-xl font-extrabold text-gray-900">{sub?.units_used ?? 0}/{sub?.unit_limit === 999999 ? '∞' : sub?.unit_limit}</p>
          </div>
        </div>
        {sub?.subscription_status === 'trialing' && (
          <div className="mt-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width:`${Math.max(5,(trialLeft/7)*100)}%`, background:trialLeft<=3?'#ef4444':'#0d9f9f' }} />
          </div>
        )}
      </div>

      {/* Subscribe section */}
      {['trialing','expired','cancelled'].includes(sub?.subscription_status ?? '') && (
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Activate Subscription</p>
          <div className="grid grid-cols-3 gap-3 mb-5">
            {PLANS.map(p => (
              <div key={p.id} onClick={() => setPlan(p.id)}
                className="rounded-xl border-2 p-3 cursor-pointer transition-all"
                style={{ borderColor:plan===p.id?'#0d9f9f':'#e2e8f0', background:plan===p.id?'#f0fafa':'white' }}>
                <p className="font-bold text-sm" style={{fontFamily:'Sora,sans-serif',color:plan===p.id?'#0d9f9f':'#0f172a'}}>{p.name}</p>
                <p className="text-lg font-extrabold text-gray-900">KES {p.price.toLocaleString()}</p>
                <p className="text-xs text-gray-400">/mo · {p.units} units</p>
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">M-Pesa Phone</label>
              <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="0712 345 678"
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-teal-400" />
            </div>
            <button onClick={pay} disabled={paying||polling}
              className="self-end px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-60 whitespace-nowrap"
              style={{background:'linear-gradient(135deg,#0d9f9f,#076666)'}}>
              {paying ? 'Sending…' : polling ? '⏳ Waiting…' : KES(PLANS.find(p=>p.id===plan)?.price??0)}
            </button>
          </div>
          {polling && (
            <div className="mt-3 p-3 bg-blue-50 rounded-xl text-xs text-blue-700 font-medium">
              📱 Check your phone for the M-Pesa prompt. This page updates automatically when payment is confirmed.
            </div>
          )}
          <p className="text-xs text-gray-400 mt-3">Secured by IntaSend · M-Pesa · Renews monthly</p>
        </div>
      )}

      {/* Need help */}
      <div className="bg-teal-50 rounded-xl p-4">
        <p className="text-sm text-gray-600">
          Need help with your subscription?{' '}
          <a href="https://wa.me/254700000000?text=Hi%2C%20I%20need%20help%20with%20my%20PropManager%20subscription"
            target="_blank" className="text-teal-600 font-semibold hover:underline">WhatsApp us →</a>
        </p>
      </div>
    </div>
  );
}


// ─── SMS SETTINGS TAB ─────────────────────────────────────────────────────────
function SmsSettingsTab() {
  const qc = useQueryClient();

  const [form, setForm] = useState({ senderId: '', atUsername: '', atApiKey: '', reason: '' });
  const [submitting, setSubmitting] = useState(false);
  const [quotaReq, setQuotaReq] = useState({ requestedQuota: '', reason: '' });
  const [quotaSubmitting, setQuotaSubmitting] = useState(false);

  // Current sender ID request status
  const { data: senderStatus, refetch } = useQuery({
    queryKey: ['sender-id-status'],
    queryFn: () => apiClient.get('/sms/sender-id-request').then((r: any) => r.data.data.request),
  });

  // Current SMS usage
  const { data: usage } = useQuery({
    queryKey: ['sms-usage'],
    queryFn: () => apiClient.get('/sms/usage').then((r: any) => r.data.data),
  });

  const usedPct = usage ? Math.min(100, Math.round((usage.used / usage.quota) * 100)) : 0;
  const barColor = usedPct >= 90 ? '#ef4444' : usedPct >= 70 ? '#f59e0b' : '#0d9f9f';

  const STATUS_MAP: Record<string, { label: string; color: string; bg: string; icon: string }> = {
    pending:  { label: 'Under Review',  color: '#92400e', bg: '#fef3c7', icon: '⏳' },
    approved: { label: 'Approved',      color: '#166534', bg: '#dcfce7', icon: '✅' },
    rejected: { label: 'Rejected',      color: '#991b1b', bg: '#fee2e2', icon: '❌' },
  };

  async function submitSenderIdRequest() {
    if (!form.senderId.trim() || !form.atUsername.trim() || !form.atApiKey.trim()) {
      toast({ title: 'Please fill in all required fields', variant: 'error' }); return;
    }
    setSubmitting(true);
    try {
      await apiClient.post('/sms/sender-id-request', {
        senderId: form.senderId.trim().toUpperCase(),
        atUsername: form.atUsername.trim(),
        atApiKey: form.atApiKey.trim(),
        reason: form.reason.trim() || undefined,
      });
      toast({ title: "Sender ID request submitted! We'll review it within 1 business day.", variant: 'success' });
      setForm({ senderId: '', atUsername: '', atApiKey: '', reason: '' });
      refetch();
    } catch(e: any) { toast({ title: getApiErrorMessage(e), variant: 'error' }); }
    setSubmitting(false);
  }

  async function submitQuotaRequest() {
    if (!quotaReq.requestedQuota) { toast({ title: 'Enter your requested quota', variant: 'error' }); return; }
    setQuotaSubmitting(true);
    try {
      await apiClient.post('/sms/quota-request', {
        requestedQuota: parseInt(quotaReq.requestedQuota),
        reason: quotaReq.reason || undefined,
      });
      toast({ title: "Quota increase requested! We'll review it within 1 business day.", variant: 'success' });
      setQuotaReq({ requestedQuota: '', reason: '' });
      qc.invalidateQueries({ queryKey: ['sms-usage'] });
    } catch(e: any) { toast({ title: getApiErrorMessage(e), variant: 'error' }); }
    setQuotaSubmitting(false);
  }

  return (
    <div className="space-y-6">

      {/* SMS Usage */}
      <Section title="SMS Usage This Month" description="Your monthly SMS usage against your plan quota.">
        <div className="space-y-3">
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-500">Used this month</span>
            <span className="font-bold" style={{ color: barColor }}>
              {usage?.used ?? 0} / {usage?.quota ?? 500} SMS ({usedPct}%)
            </span>
          </div>
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500"
              style={{ width: `${usedPct}%`, background: barColor }} />
          </div>
          {usedPct >= 80 && (
            <div className="p-3 rounded-xl text-sm font-medium"
              style={{ background: usedPct >= 90 ? '#fee2e2' : '#fef3c7', color: usedPct >= 90 ? '#991b1b' : '#92400e' }}>
              {usedPct >= 90 ? '🚨' : '⚠️'} You've used {usedPct}% of your monthly SMS quota.
              {usedPct >= 90 ? ' Request an increase below before you run out.' : ' Consider requesting a quota increase.'}
            </div>
          )}
          {usage?.reset_date && (
            <p className="text-xs text-gray-400">Resets on {new Date(usage.reset_date).toLocaleDateString('en-KE', { day: 'numeric', month: 'long' })}</p>
          )}
        </div>

        {/* Quota increase request */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          <p className="text-sm font-semibold text-gray-700 mb-3">Request Quota Increase</p>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">New monthly quota (SMS)</label>
              <input type="number" value={quotaReq.requestedQuota}
                onChange={e => setQuotaReq(q => ({...q, requestedQuota: e.target.value}))}
                placeholder={`More than ${usage?.quota ?? 500}`} min={(usage?.quota ?? 500) + 1}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-teal-400" />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">Reason (optional)</label>
              <input value={quotaReq.reason}
                onChange={e => setQuotaReq(q => ({...q, reason: e.target.value}))}
                placeholder="e.g. Expanding portfolio"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-teal-400" />
            </div>
            <button onClick={submitQuotaRequest} disabled={quotaSubmitting}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60 whitespace-nowrap"
              style={{ background: 'linear-gradient(135deg,#0d9f9f,#076666)' }}>
              {quotaSubmitting ? 'Sending…' : 'Request Increase'}
            </button>
          </div>
        </div>
      </Section>

      {/* Current Sender ID status */}
      <Section title="Custom Sender ID" description="Use your own branded sender ID instead of the shared AFRICASTKNG ID.">
        {senderStatus ? (
          <div>
            <div className="p-4 rounded-xl border flex items-start gap-3 mb-4"
              style={{ background: STATUS_MAP[senderStatus.status]?.bg, borderColor: STATUS_MAP[senderStatus.status]?.color + '30' }}>
              <span className="text-xl">{STATUS_MAP[senderStatus.status]?.icon}</span>
              <div>
                <p className="font-bold text-sm" style={{ color: STATUS_MAP[senderStatus.status]?.color }}>
                  Request {STATUS_MAP[senderStatus.status]?.label}
                </p>
                <p className="text-sm text-gray-600 mt-0.5">
                  Sender ID: <span className="font-mono font-bold">{senderStatus.sender_id}</span>
                  {' · '}Submitted {new Date(senderStatus.created_at).toLocaleDateString('en-KE', { day:'numeric', month:'short', year:'numeric' })}
                </p>
                {senderStatus.status === 'approved' && (
                  <p className="text-sm text-green-700 mt-1 font-medium">✅ Your sender ID is active. All SMS will now use <strong>{senderStatus.sender_id}</strong>.</p>
                )}
                {senderStatus.status === 'rejected' && senderStatus.rejection_note && (
                  <p className="text-sm text-red-700 mt-1">Reason: {senderStatus.rejection_note}</p>
                )}
              </div>
            </div>
            {senderStatus.status === 'rejected' && (
              <p className="text-sm text-gray-500 mb-4">You can submit a new request below with updated information.</p>
            )}
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 mb-4">
            <p className="text-sm text-gray-600">No sender ID request yet. Submit one below to use your own branded SMS sender name.</p>
          </div>
        )}

        {/* Request form — show if no pending/approved request */}
        {(!senderStatus || senderStatus.status === 'rejected') && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Sender ID * <span className="font-normal text-gray-400">(max 11 chars)</span></label>
                <input value={form.senderId} onChange={e => setForm(f => ({...f, senderId: e.target.value.toUpperCase()}))}
                  placeholder="e.g. WESTGATE" maxLength={11}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm font-mono outline-none focus:border-teal-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">AT Username *</label>
                <input value={form.atUsername} onChange={e => setForm(f => ({...f, atUsername: e.target.value}))}
                  placeholder="Your Africa's Talking username"
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-teal-400" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">AT API Key *</label>
              <PasswordInput value={form.atApiKey} onChange={e => setForm(f => ({...f, atApiKey: e.target.value}))}
                placeholder="Your Africa's Talking API key"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-teal-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Reason for custom sender ID <span className="font-normal text-gray-400">(optional)</span></label>
              <input value={form.reason} onChange={e => setForm(f => ({...f, reason: e.target.value}))}
                placeholder="e.g. Brand recognition for 200+ tenants"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-teal-400" />
            </div>
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
              <p className="font-semibold mb-1">📋 Before you submit:</p>
              <ul className="space-y-1 list-disc list-inside">
                <li>Register at <strong>account.africastalking.com</strong></li>
                <li>Request your sender ID from AT first (2–5 business days)</li>
                <li>Once AT approves it, submit here so we can enable it for you</li>
              </ul>
            </div>
            <button onClick={submitSenderIdRequest} disabled={submitting}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60 transition"
              style={{ background: 'linear-gradient(135deg,#0d9f9f,#076666)' }}>
              {submitting ? 'Submitting…' : 'Submit Sender ID Request'}
            </button>
          </div>
        )}
      </Section>

      {/* Notification preferences */}
      <Section title="Notification Preferences" description="Choose how you receive system notifications — subscription alerts, trial reminders, payment confirmations.">
        <NotificationPrefsForm />
      </Section>
    </div>
  );
}

// ─── NOTIFICATION PREFERENCES ─────────────────────────────────────────────────
function NotificationPrefsForm() {
  const { company: authCompany } = useAuthStore();
  const [prefs, setPrefs] = useState({ sms: true, email: true });
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useQuery({
    queryKey: ['notif-prefs'],
    queryFn: async () => {
      const r: any = await apiClient.get(`/companies/${authCompany?.id}/settings`);
      const s = r.data.data.company;
      setPrefs({ sms: s.owner_notify_sms ?? true, email: s.owner_notify_email ?? true });
      setLoaded(true);
      return s;
    },
    enabled: !!authCompany?.id,
  });

  async function save() {
    setSaving(true);
    try {
      await apiClient.patch(`/companies/${authCompany?.id}/settings`, {
        owner_notify_sms:   prefs.sms,
        owner_notify_email: prefs.email,
      });
      toast({ title: 'Notification preferences saved', variant: 'success' });
    } catch(e: any) { toast({ title: getApiErrorMessage(e), variant: 'error' }); }
    setSaving(false);
  }

  if (!loaded) return <div className="text-sm text-gray-400">Loading…</div>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">These settings control how <strong>you</strong> receive system notifications. Tenant-facing SMS/email settings are separate.</p>
      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" checked={prefs.sms} onChange={e => setPrefs(p => ({...p, sms: e.target.checked}))}
          className="w-4 h-4 rounded accent-teal-600" />
        <div>
          <p className="text-sm font-semibold text-gray-900">SMS Notifications</p>
          <p className="text-xs text-gray-400">Receive subscription alerts, trial reminders and payment confirmations via SMS</p>
        </div>
      </label>
      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" checked={prefs.email} onChange={e => setPrefs(p => ({...p, email: e.target.checked}))}
          className="w-4 h-4 rounded accent-teal-600" />
        <div>
          <p className="text-sm font-semibold text-gray-900">Email Notifications</p>
          <p className="text-xs text-gray-400">Receive subscription alerts, trial reminders and payment confirmations via email</p>
        </div>
      </label>
      {!prefs.sms && !prefs.email && (
        <p className="text-xs text-amber-700 bg-amber-50 px-3 py-2 rounded-lg">⚠️ Enable at least one notification method so you don't miss important alerts.</p>
      )}
      <button onClick={save} disabled={saving}
        className="px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
        style={{ background: 'linear-gradient(135deg,#0d9f9f,#076666)' }}>
        {saving ? 'Saving…' : 'Save Preferences'}
      </button>
    </div>
  );
}