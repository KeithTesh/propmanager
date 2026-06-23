// web/src/pages/setup/SetupWizard.tsx

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { apiClient, getApiErrorMessage } from '../../lib/api';
import { toast } from '../../components/ui/toaster';

interface StepInfo { number: number; label: string; description: string; }

const LANDLORD_STEPS: StepInfo[] = [
  { number: 1, label: 'Company Profile',   description: 'Basic company information' },
  { number: 2, label: 'Payment Method',    description: 'How tenants pay rent' },
  { number: 3, label: 'Billing Config',    description: 'Due dates and penalties' },
  { number: 4, label: 'Proration',         description: 'Partial month billing rules' },
  { number: 5, label: 'Notifications',     description: 'SMS reminders setup' },
];

const AGENT_STEPS: StepInfo[] = [
  { number: 1, label: 'Company Profile',       description: 'Your agency information' },
  { number: 2, label: 'Payment Method',        description: 'How tenants pay rent' },
  { number: 3, label: 'First Landlord Client', description: 'Add your first landlord client' },
  { number: 4, label: 'Commission Settings',   description: 'Default commission rate' },
  { number: 5, label: 'Notifications',         description: 'SMS reminders setup' },
];

const COUNTIES = [
  'Nairobi','Mombasa','Kisumu','Nakuru','Eldoret','Thika','Malindi',
  'Kitale','Garissa','Kakamega','Nyeri','Meru','Embu','Machakos',
  'Kilifi','Kwale','Kajiado',"Murang'a",'Kirinyaga','Nyandarua',
  'Laikipia','Samburu','Trans-Nzoia','Uasin Gishu','Elgeyo-Marakwet',
  'Nandi','Baringo','Kericho','Bomet','Siaya','Kisii','Nyamira',
  'Migori','Homa Bay','Bungoma','Busia','Vihiga','Tana River',
  'Lamu','Taita-Taveta','Makueni','Kitui','Tharaka-Nithi','Isiolo',
  'Marsabit','Wajir','Mandera','Turkana','West Pokot',
];

// ─── FIELD COMPONENTS ─────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

const inputCls = "w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition placeholder-gray-400";
const selectCls = `${inputCls} bg-white`;

// ─── STEP 0 — Account Type Selection ──────────────────────────────────────────

function Step0({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500 mb-6">
        This determines how PropManager is set up for your account. You cannot change this later.
      </p>
      {[
        {
          value: 'landlord',
          icon: '🏠',
          title: 'I manage my own properties',
          desc: 'You own properties and manage them directly. Tenants pay you directly.',
        },
        {
          value: 'agent',
          icon: '🏢',
          title: 'I manage properties on behalf of landlords',
          desc: 'You are a property management agency. You manage portfolios for multiple landlord clients and remit rent to them after deducting your commission.',
        },
      ].map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`w-full text-left p-5 rounded-xl border-2 transition ${
            value === opt.value
              ? 'border-brand-500 bg-brand-50'
              : 'border-gray-200 hover:border-gray-300 bg-white'
          }`}
        >
          <div className="flex items-start gap-4">
            <span className="text-3xl mt-0.5">{opt.icon}</span>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <p className={`font-semibold text-sm ${value === opt.value ? 'text-brand-700' : 'text-gray-900'}`}>
                  {opt.title}
                </p>
                {value === opt.value && (
                  <span className="text-xs font-bold text-brand-700 bg-brand-100 px-2 py-0.5 rounded-full">Selected</span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">{opt.desc}</p>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

// ─── STEP 1 ────────────────────────────────────────────────────────────────────

function Step1({ data, onChange }: { data: Record<string, string>; onChange: (k: string, v: string) => void }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Field label="Company / Agency Name *">
          <input value={data.name ?? ''} onChange={e => onChange('name', e.target.value)}
            placeholder="Westgate Properties Ltd" className={inputCls} />
        </Field>
        <Field label="Trading Name" hint="Leave blank if same as above">
          <input value={data.tradingName ?? ''} onChange={e => onChange('tradingName', e.target.value)}
            placeholder="Westgate" className={inputCls} />
        </Field>
        <Field label="Phone *">
          <input value={data.phone ?? ''} onChange={e => onChange('phone', e.target.value)}
            placeholder="0700 000 000" type="tel" className={inputCls} />
        </Field>
        <Field label="Email *">
          <input value={data.email ?? ''} onChange={e => onChange('email', e.target.value)}
            placeholder="info@company.co.ke" type="email" className={inputCls} />
        </Field>
        <Field label="County">
          <select value={data.county ?? ''} onChange={e => onChange('county', e.target.value)} className={selectCls}>
            <option value="">Select county</option>
            {COUNTIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="KRA PIN" hint="Optional — for invoicing">
          <input value={data.kraPin ?? ''} onChange={e => onChange('kraPin', e.target.value)}
            placeholder="P051234567A" className={inputCls} />
        </Field>
        <Field label="Address" hint="Physical office address">
          <input value={data.address ?? ''} onChange={e => onChange('address', e.target.value)}
            placeholder="Westlands, Nairobi" className={inputCls} />
        </Field>
        <Field label="Registration Number" hint="Business registration number if applicable">
          <input value={data.registrationNumber ?? ''} onChange={e => onChange('registrationNumber', e.target.value)}
            placeholder="CPR/2024/XXXXXX" className={inputCls} />
        </Field>
      </div>
    </div>
  );
}

// ─── STEP 2 ────────────────────────────────────────────────────────────────────

function Step2({ data, onChange }: { data: Record<string, string>; onChange: (k: string, v: string) => void }) {
  const method = data.paymentMethod ?? 'cash';
  return (
    <div className="space-y-5">
      <Field label="Primary Payment Method *">
        <select value={method} onChange={e => onChange('paymentMethod', e.target.value)} className={selectCls}>
          <option value="cash">Cash</option>
          <option value="bank_paybill">M-Pesa PayBill</option>
          <option value="daraja_stk">M-Pesa Till / STK Push</option>
          <option value="manual">Bank Transfer / Manual</option>
        </select>
      </Field>
      {method === 'bank_paybill' && (
        <>
          <Field label="PayBill Number *">
            <input value={data.paybillNumber ?? ''} onChange={e => onChange('paybillNumber', e.target.value)}
              placeholder="303030" className={inputCls} />
          </Field>
          <Field label="Account Format" hint="Use {unit} for unit number, {lease_id} for lease ID">
            <input value={data.paybillAccountFormat ?? ''} onChange={e => onChange('paybillAccountFormat', e.target.value)}
              placeholder="e.g. {unit} or APT-{unit}" className={inputCls} />
          </Field>
        </>
      )}
      {method === 'daraja_stk' && (
        <Field label="Till Number *">
          <input value={data.tillNumber ?? ''} onChange={e => onChange('tillNumber', e.target.value)}
            placeholder="123456" className={inputCls} />
        </Field>
      )}
      {method === 'manual' && (
        <>
          <Field label="Bank Name *">
            <input value={data.bankName ?? ''} onChange={e => onChange('bankName', e.target.value)}
              placeholder="Equity Bank" className={inputCls} />
          </Field>
          <Field label="Account Number *">
            <input value={data.bankAccountNumber ?? ''} onChange={e => onChange('bankAccountNumber', e.target.value)}
              placeholder="0123456789" className={inputCls} />
          </Field>
          <Field label="Branch">
            <input value={data.bankBranch ?? ''} onChange={e => onChange('bankBranch', e.target.value)}
              placeholder="Westlands" className={inputCls} />
          </Field>
        </>
      )}
    </div>
  );
}

// ─── STEP 3 — Landlord: Billing Config | Agent: First Landlord Client ─────────

function Step3Landlord({ data, onChange }: { data: Record<string, string>; onChange: (k: string, v: string) => void }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Field label="Rent Due Day" hint="Day of month rent is due (1–28)">
          <input type="number" min={1} max={28} value={data.dueDay ?? '1'}
            onChange={e => onChange('dueDay', e.target.value)} className={inputCls} />
        </Field>
        <Field label="Grace Period (days)" hint="Days after due date before penalty applies">
          <input type="number" min={0} max={30} value={data.gracePeriodDays ?? '0'}
            onChange={e => onChange('gracePeriodDays', e.target.value)} className={inputCls} />
        </Field>
        <Field label="Late Payment Penalty">
          <select value={data.penaltyType ?? 'none'} onChange={e => onChange('penaltyType', e.target.value)} className={selectCls}>
            <option value="none">No penalty</option>
            <option value="flat">Flat fee (KES)</option>
            <option value="percentage">Percentage of rent</option>
          </select>
        </Field>
        {data.penaltyType && data.penaltyType !== 'none' && (
          <Field label={data.penaltyType === 'flat' ? 'Penalty Amount (KES)' : 'Penalty Percentage (%)'}>
            <input type="number" min={0} value={data.penaltyValue ?? ''}
              onChange={e => onChange('penaltyValue', e.target.value)}
              placeholder={data.penaltyType === 'flat' ? '500' : '5'} className={inputCls} />
          </Field>
        )}
      </div>
    </div>
  );
}

function Step3Agent({ data, onChange }: { data: Record<string, string>; onChange: (k: string, v: string) => void }) {
  return (
    <div className="space-y-5">
      <div className="p-4 rounded-xl bg-teal-50 border border-teal-200 text-sm text-teal-800 mb-2">
        <p className="font-semibold mb-1">Add your first landlord client</p>
        <p className="text-xs leading-relaxed">A landlord client is a property owner whose portfolio you manage. You can invite them to a read-only portal to track their collections and remittances.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Field label="Full Name *">
          <input value={data.landlordName ?? ''} onChange={e => onChange('landlordName', e.target.value)}
            placeholder="John Kamau" className={inputCls} />
        </Field>
        <Field label="Phone">
          <input value={data.landlordPhone ?? ''} onChange={e => onChange('landlordPhone', e.target.value)}
            placeholder="0700 000 000" type="tel" className={inputCls} />
        </Field>
        <Field label="Email">
          <input value={data.landlordEmail ?? ''} onChange={e => onChange('landlordEmail', e.target.value)}
            placeholder="john@email.com" type="email" className={inputCls} />
        </Field>
        <Field label="KRA PIN" hint="Optional — for remittance statements">
          <input value={data.landlordKraPin ?? ''} onChange={e => onChange('landlordKraPin', e.target.value)}
            placeholder="A001234567K" className={inputCls} />
        </Field>
        <Field label="Bank Name" hint="For remittance payments">
          <input value={data.landlordBankName ?? ''} onChange={e => onChange('landlordBankName', e.target.value)}
            placeholder="KCB Bank" className={inputCls} />
        </Field>
        <Field label="Bank Account Number">
          <input value={data.landlordBankAccount ?? ''} onChange={e => onChange('landlordBankAccount', e.target.value)}
            placeholder="0123456789" className={inputCls} />
        </Field>
      </div>
    </div>
  );
}

// ─── STEP 4 — Landlord: Proration | Agent: Commission Settings ────────────────

function Step4Landlord({ data, onChange }: { data: Record<string, string>; onChange: (k: string, v: string) => void }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Field label="Move-in Proration" hint="How to bill partial first month">
          <select value={data.moveInProrationMode ?? 'always'} onChange={e => onChange('moveInProrationMode', e.target.value)} className={selectCls}>
            <option value="always">Always prorate</option>
            <option value="after_cutoff">Prorate only after cutoff day</option>
            <option value="never">Never prorate — charge full month</option>
          </select>
        </Field>
        {data.moveInProrationMode === 'after_cutoff' && (
          <Field label="Cutoff Day" hint="Prorate only if move-in is after this day">
            <input type="number" min={1} max={28} value={data.moveInProrationCutoff ?? '15'}
              onChange={e => onChange('moveInProrationCutoff', e.target.value)} className={inputCls} />
          </Field>
        )}
        <Field label="Move-out Proration">
          <select value={data.moveOutProrationMode ?? 'full_month'} onChange={e => onChange('moveOutProrationMode', e.target.value)} className={selectCls}>
            <option value="full_month">Charge full month</option>
            <option value="to_actual_date">Prorate to move-out date</option>
          </select>
        </Field>
        <Field label="Minimum Proration Threshold (KES)" hint="Amounts below this are treated as no proration">
          <input type="number" min={0} value={data.minProrationThreshold ?? '500'}
            onChange={e => onChange('minProrationThreshold', e.target.value)} className={inputCls} />
        </Field>
      </div>
    </div>
  );
}

function Step4Agent({ data, onChange }: { data: Record<string, string>; onChange: (k: string, v: string) => void }) {
  return (
    <div className="space-y-5">
      <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800 mb-2">
        <p className="font-semibold mb-1">Default commission settings</p>
        <p className="text-xs leading-relaxed">This is your agency's default commission. You can override it per landlord client or per property later.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Field label="Commission Type *">
          <select value={data.commissionType ?? 'percentage'} onChange={e => onChange('commissionType', e.target.value)} className={selectCls}>
            <option value="percentage">Percentage of rent collected</option>
            <option value="flat">Flat monthly fee (KES)</option>
          </select>
        </Field>
        <Field
          label={(data.commissionType ?? 'percentage') === 'flat' ? 'Flat Fee (KES per month)' : 'Commission Rate (%)'}
          hint={(data.commissionType ?? 'percentage') === 'flat' ? 'Fixed amount deducted per landlord per month' : 'Percentage of rent actually collected'}
        >
          <input type="number" min={0} max={data.commissionType === 'percentage' ? 100 : undefined}
            value={data.commissionValue ?? '10'}
            onChange={e => onChange('commissionValue', e.target.value)}
            placeholder={data.commissionType === 'flat' ? '5000' : '10'}
            className={inputCls} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Rent Due Day" hint="Day of month rent is due (1–28) — applies to all managed properties">
            <input type="number" min={1} max={28} value={data.dueDay ?? '1'}
              onChange={e => onChange('dueDay', e.target.value)} className={inputCls} />
          </Field>
        </div>
      </div>
    </div>
  );
}

// ─── STEP 5 — Notifications (same for both) ───────────────────────────────────

function Step5({ data, onChange }: { data: Record<string, string>; onChange: (k: string, v: string) => void }) {
  return (
    <div className="space-y-5">
      <Field label="SMS Sender ID" hint="Leave blank to use shared sender ID (AFRICASTKNG). Request a custom one after setup in SMS Settings.">
        <input value={data.smsSenderId ?? ''} onChange={e => onChange('smsSenderId', e.target.value.toUpperCase())}
          placeholder="e.g. WESTGATE" maxLength={11} className={`${inputCls} font-mono tracking-widest`} />
      </Field>
      <Field label="Reminder days before due date" hint="Comma-separated, e.g. 7,3,0 (0 = on due date)">
        <input value={data.reminderDaysBefore ?? '7,3,0'} onChange={e => onChange('reminderDaysBefore', e.target.value)}
          placeholder="7,3,0" className={inputCls} />
      </Field>
      <Field label="Reminder days after due date" hint="Comma-separated, e.g. 3,7">
        <input value={data.reminderDaysAfter ?? '3'} onChange={e => onChange('reminderDaysAfter', e.target.value)}
          placeholder="3" className={inputCls} />
      </Field>
    </div>
  );
}

// ─── MAIN WIZARD ──────────────────────────────────────────────────────────────

export default function SetupWizard() {
  const navigate  = useNavigate();
  const { company, setCompany } = useAuthStore();

  // Determine account type — from auth store (set at registration) or default landlord
  const accountType = (company as any)?.accountType ?? 'landlord';
  const isAgent     = accountType === 'agent';
  const STEPS       = isAgent ? AGENT_STEPS : LANDLORD_STEPS;

  // Step 0 is only shown if account_type is not yet set (shouldn't happen after register)
  // but we keep it as a safety fallback
  const [showStep0, setShowStep0]   = useState(false);
  const [acctType,  setAcctType]    = useState(accountType);
  const [currentStep, setCurrentStep] = useState(company?.setupCurrentStep ?? 1);
  const [formData, setFormData]     = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');

  useEffect(() => {
    if (company) {
      setFormData(prev => ({
        ...prev,
        1: {
          name:               company.name ?? '',
          tradingName:        (company as any).tradingName ?? '',
          ...prev[1],
        },
      }));
    }
  }, [company]);

  function setField(step: number, key: string, value: string) {
    setFormData(prev => ({
      ...prev,
      [step]: { ...(prev[step] ?? {}), [key]: value },
    }));
  }

  function getStepData(step: number): Record<string, string> {
    return formData[step] ?? {};
  }

  async function handleStep0Next() {
    // Save account type via settings PATCH then proceed to step 1
    try {
      await apiClient.patch('/companies/settings', { accountType: acctType });
      if (company) setCompany({ ...company, ...(({ accountType: acctType } as any)) });
      setShowStep0(false);
    } catch(e) {
      setError(getApiErrorMessage(e));
    }
  }

  async function handleNext() {
    setError('');
    setLoading(true);
    try {
      const raw = getStepData(currentStep);
      let payload: Record<string, unknown> = {};

      if (currentStep === 1) {
        payload = {
          name: raw.name, tradingName: raw.tradingName || null,
          phone: raw.phone, email: raw.email,
          address: raw.address || null, county: raw.county || null,
          registrationNumber: raw.registrationNumber || null,
          kraPin: raw.kraPin || null,
        };
      } else if (currentStep === 2) {
        payload = {
          paymentMethod: raw.paymentMethod ?? 'cash',
          paybillNumber: raw.paybillNumber || null,
          paybillAccountFormat: raw.paybillAccountFormat || null,
          tillNumber: raw.tillNumber || null,
          bankName: raw.bankName || null,
          bankAccountNumber: raw.bankAccountNumber || null,
          bankBranch: raw.bankBranch || null,
        };
      } else if (currentStep === 3) {
        if (isAgent) {
          // Agent step 3 — create first landlord client (optional), then advance step
          // The API setup/3 always expects billing config; landlord creation is a side-effect
          if (raw.landlordName?.trim()) {
            await apiClient.post('/landlords', {
              fullName:    raw.landlordName.trim(),
              phone:       raw.landlordPhone       || null,
              email:       raw.landlordEmail       || null,
              kraPin:      raw.landlordKraPin      || null,
              bankName:    raw.landlordBankName    || null,
              bankAccount: raw.landlordBankAccount || null,
            });
          }
          // Advance setup step with billing config defaults (what the API expects)
          payload = { dueDay: 1, gracePeriodDays: 0, penaltyType: 'none', penaltyValue: null, penaltyAppliesAfterDays: null };
        } else {
          // Landlord step 3 — billing config
          payload = {
            dueDay:                  parseInt(raw.dueDay || '1'),
            gracePeriodDays:         parseInt(raw.gracePeriodDays || '0'),
            penaltyType:             raw.penaltyType ?? 'none',
            penaltyValue:            raw.penaltyValue ? parseFloat(raw.penaltyValue) : null,
            penaltyAppliesAfterDays: raw.penaltyAppliesAfterDays ? parseInt(raw.penaltyAppliesAfterDays) : null,
          };
        }
      } else if (currentStep === 4) {
        if (isAgent) {
          // Agent step 4 — commission settings are saved per-landlord later in Settings.
          // Advance setup step with proration defaults (what the API expects for step 4).
          payload = {
            moveInProrationMode:  'never',
            moveInProrationMethod: 'actual_days',
            moveOutProrationMode:  'full_month',
            billFirstPartialMonth: false,
            minProrationThreshold: 0,
          };
        } else {
          // Landlord step 4 — proration
          payload = {
            moveInProrationMode:   raw.moveInProrationMode ?? 'always',
            moveInProrationCutoff: raw.moveInProrationCutoff ? parseInt(raw.moveInProrationCutoff) : null,
            moveInProrationMethod: raw.moveInProrationMethod ?? 'actual_days',
            moveOutProrationMode:  raw.moveOutProrationMode ?? 'full_month',
            billFirstPartialMonth: (raw.billFirstPartialMonth ?? 'true') === 'true',
            minProrationThreshold: parseInt(raw.minProrationThreshold || '500'),
          };
        }
      } else if (currentStep === 5) {
        const before = (raw.reminderDaysBefore ?? '7,3,0').split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
        const after  = (raw.reminderDaysAfter  ?? '3').split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
        payload = {
          smsSenderId:         raw.smsSenderId || null,
          reminderDaysBefore:  before,
          reminderDaysAfter:   after,
        };
      }

      const res = await apiClient.post<{ data: { setupCompleted: boolean; nextStep: number } }>(
        `/companies/setup/${currentStep}`,
        payload
      );

      const { setupCompleted, nextStep } = res.data.data;

      if (setupCompleted) {
        if (company) setCompany({ ...company, setupCompleted: true });
        toast({ title: 'Setup complete! Welcome to PropManager.', variant: 'success' });
        navigate('/dashboard', { replace: true });
      } else {
        setCurrentStep(nextStep);
      }
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  // Skip defaults — what to post so the API step counter advances without user data
  const SKIP_DEFAULTS: Record<number, Record<string, unknown>> = {
    3: { dueDay: 1, gracePeriodDays: 0, penaltyType: 'none', penaltyValue: null, penaltyAppliesAfterDays: null },
    4: { moveInProrationMode: 'never', moveInProrationMethod: 'actual_days', moveOutProrationMode: 'full_month', billFirstPartialMonth: false, minProrationThreshold: 0 },
  };

  async function handleSkip() {
    setError('');
    setLoading(true);
    try {
      const payload = SKIP_DEFAULTS[currentStep];
      if (!payload) { setCurrentStep(s => Math.min(s + 1, STEPS.length)); return; }
      const res = await apiClient.post<{ data: { setupCompleted: boolean; nextStep: number } }>(
        `/companies/setup/${currentStep}`, payload
      );
      const { setupCompleted, nextStep } = res.data.data;
      if (setupCompleted) {
        if (company) setCompany({ ...company, setupCompleted: true });
        toast({ title: 'Setup complete! Welcome to PropManager.', variant: 'success' });
        navigate('/dashboard', { replace: true });
      } else {
        setCurrentStep(nextStep);
      }
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const stepData = getStepData(currentStep);

  // ── STEP 0 SCREEN ──────────────────────────────────────────────────────────
  if (showStep0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="w-full max-w-lg">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
              style={{ background: 'linear-gradient(135deg,#0d9f9f,#076666)' }}>
              <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Welcome to PropManager</h1>
            <p className="text-gray-500 mt-2 text-sm">First, tell us how you'll be using the platform</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <Step0 value={acctType} onChange={setAcctType} />
            {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
            <button onClick={handleStep0Next}
              className="mt-6 w-full py-2.5 rounded-lg text-sm font-semibold text-white transition"
              style={{ background: '#0d9f9f' }}>
              Continue →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── MAIN WIZARD ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex">

      {/* Sidebar */}
      <div className="hidden lg:flex flex-col w-72 bg-white border-r border-gray-100 p-8">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #0d9f9f, #076666)' }}>
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">PropManager</p>
            <p className="text-xs text-gray-400">{isAgent ? 'Agency Setup' : 'Company Setup'}</p>
          </div>
        </div>

        {/* Account type badge */}
        <div className={`mb-6 px-3 py-2 rounded-lg text-xs font-semibold ${
          isAgent ? 'bg-purple-50 text-purple-700' : 'bg-teal-50 text-teal-700'
        }`}>
          {isAgent ? '🏢 Agent Account' : '🏠 Landlord Account'}
        </div>

        <div className="space-y-1">
          {STEPS.map((step) => {
            const isDone    = step.number < currentStep;
            const isCurrent = step.number === currentStep;
            return (
              <div key={step.number}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition ${isCurrent ? 'bg-brand-50' : ''}`}>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition
                  ${isDone || isCurrent ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-400'}`}>
                  {isDone
                    ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    : step.number}
                </div>
                <div>
                  <p className={`text-sm font-medium ${isCurrent ? 'text-brand-700' : isDone ? 'text-gray-600' : 'text-gray-400'}`}>
                    {step.label}
                  </p>
                  <p className="text-xs text-gray-400">{step.description}</p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-auto pt-8">
          <div className="h-1.5 bg-gray-100 rounded-full">
            <div className="h-full bg-brand-500 rounded-full transition-all duration-500"
              style={{ width: `${((currentStep - 1) / (STEPS.length - 1)) * 100}%` }} />
          </div>
          <p className="text-xs text-gray-400 mt-2">Step {currentStep} of {STEPS.length}</p>
        </div>
      </div>

      {/* Main form */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-2xl">

          <div className="mb-8">
            <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-brand-50 text-brand-700 mb-3">
              Step {currentStep} of {STEPS.length}
            </span>
            <h1 className="text-2xl font-bold text-gray-900">{STEPS[currentStep - 1].label}</h1>
            <p className="text-gray-500 mt-1 text-sm">{STEPS[currentStep - 1].description}</p>
          </div>

          {error && (
            <div className="mb-5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 flex items-start gap-2">
              <svg className="w-4 h-4 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
              </svg>
              {error}
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 lg:p-8">
            {currentStep === 1 && <Step1 data={stepData} onChange={(k,v) => setField(1,k,v)} />}
            {currentStep === 2 && <Step2 data={stepData} onChange={(k,v) => setField(2,k,v)} />}
            {currentStep === 3 && !isAgent && <Step3Landlord data={stepData} onChange={(k,v) => setField(3,k,v)} />}
            {currentStep === 3 &&  isAgent && <Step3Agent    data={stepData} onChange={(k,v) => setField(3,k,v)} />}
            {currentStep === 4 && !isAgent && <Step4Landlord data={stepData} onChange={(k,v) => setField(4,k,v)} />}
            {currentStep === 4 &&  isAgent && <Step4Agent    data={stepData} onChange={(k,v) => setField(4,k,v)} />}
            {currentStep === 5 && <Step5 data={stepData} onChange={(k,v) => setField(5,k,v)} />}
          </div>

          <div className="flex items-center justify-between mt-6">
            <button onClick={() => setCurrentStep(s => Math.max(1, s - 1))}
              disabled={currentStep === 1}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-white hover:shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              Back
            </button>

            <div className="flex items-center gap-3">
              {SKIP_DEFAULTS[currentStep] && (
                <button onClick={handleSkip} disabled={loading}
                  className="px-4 py-2.5 rounded-lg text-sm font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition disabled:opacity-40">
                  Skip for now
                </button>
              )}

            <button onClick={handleNext} disabled={loading}
              className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold text-white transition disabled:opacity-60"
              style={{ background: '#0d9f9f' }}>
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Saving…
                </>
              ) : currentStep === STEPS.length ? (
                <>
                  Complete Setup
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </>
              ) : (
                <>
                  Next Step
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </>
              )}
            </button>
            </div>{/* end right-side button group */}
          </div>
        </div>
      </div>
    </div>
  );
}