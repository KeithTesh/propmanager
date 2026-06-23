// web/src/pages/payroll/PayrollPage.tsx

import React, { useState } from 'react';
import { useToast } from '../../components/ui/Toast';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, getApiErrorMessage } from '../../lib/api';
import { useAuthStore } from '../../stores/authStore';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Employee {
  id: string; full_name: string; job_title: string; department?: string;
  employment_type: string; gross_salary: string; house_allowance: string;
  transport_allowance: string; other_allowances: string;
  helb_deduction: string; sacco_deduction: string; loan_deduction: string;
  other_deductions: string; advance_balance: string;
  phone?: string; email?: string; bank_name?: string; bank_account?: string;
  mpesa_number?: string; preferred_payment_channel: string;
  property_name?: string; is_active: boolean; start_date: string;
  kra_pin?: string; nssf_number?: string; shif_number?: string;
  national_id?: string;
}

interface PayrollRun {
  id: string; payroll_month: string; status: 'draft' | 'approved' | 'paid' | 'cancelled' | 'archived';
  total_gross: string; total_net: string; total_paye: string;
  total_nssf_employee: string; total_nssf_employer: string;
  total_shif: string; total_ahl_employee: string; total_ahl_employer: string;
  total_nita: string; employee_count: string;
  created_by_name?: string; approved_by_name?: string;
  approved_at?: string; paid_at?: string; notes?: string;
}

interface PayrollItem {
  id: string; employee_id: string; employee_name: string; job_title: string;
  total_gross: string; paye: string; nssf_employee: string; shif_employee: string;
  ahl_employee: string; advance_deduction: string; total_deductions: string;
  net_pay: string; nssf_employer: string; ahl_employer: string; nita: string;
  taxable_income: string; is_paid: boolean;
  emp_bank_name?: string; emp_bank_account?: string; emp_mpesa_number?: string;
  preferred_payment_channel: string;
}

interface Advance {
  id: string; employee_id: string; employee_name: string; job_title: string;
  amount: string; reason?: string; repayment_months: number;
  monthly_deduction: string; remaining_balance: string;
  is_disbursed: boolean; disbursed_at?: string;
  approved_by_name?: string; created_at: string;
}

// ─── Utils ────────────────────────────────────────────────────────────────────

const KES = (n: string | number) =>
  'KES ' + Number(n).toLocaleString('en-KE', { maximumFractionDigits: 0 });

const fmtMonth = (d: string) => {
  // Postgres may return full ISO string or date-only — normalise to date part only
  const datePart = d.slice(0, 10);
  return new Date(datePart + 'T12:00:00').toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
};

const inputCls  = 'w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500';
const selectCls = inputCls;

const STATUS_BADGE: Record<string, string> = {
  draft:     'bg-amber-100 text-amber-800',
  approved:  'bg-blue-100 text-blue-800',
  paid:      'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-600',
  archived:  'bg-gray-100 text-gray-400',
};

const CURRENT_MONTH = new Date().toISOString().slice(0, 7);

// ─── Payslip Preview ──────────────────────────────────────────────────────────

function PayslipPreview({ emp }: { emp: Employee }) {
  const { data } = useQuery({
    queryKey: ['payslip-preview', emp.id],
    queryFn: () => apiClient.get(`/payroll/employees/${emp.id}/payslip-preview`).then((r: any) => r.data.data),
  });
  if (!data) return <div className="p-4 text-sm text-gray-500">Loading…</div>;
  const p = data.payslip;
  const hasReliefs = (p.disabilityRelief + p.insuranceReliefApplied + p.mortgageReliefApplied + p.pensionReliefApplied + p.postRetirementApplied) > 0;
  const hasVoluntary = (p.helbDeduction + p.saccoDeduction + p.loanDeduction + p.advanceDeduction + p.otherDeductions) > 0;
  return (
    <div className="mt-3 rounded-xl border border-gray-200 overflow-hidden text-sm">
      <div className="bg-teal-700 text-white px-4 py-2.5 font-semibold">Payslip Preview — {emp.full_name}</div>
      <div className="divide-y divide-gray-100">

        {/* Earnings */}
        <div className="px-4 py-3 bg-green-50">
          <div className="font-medium text-gray-500 mb-1.5 text-xs uppercase tracking-wider">Earnings</div>
          <Row label="Basic Salary (Pensionable)" val={KES(p.basicSalary)} />
          {Number(emp.house_allowance) > 0 && <>
            <Row label="House Allowance" val={KES(emp.house_allowance)} />
            {p.nonTaxableAllowances > 0 && <Row label="  — Non-taxable portion" val={`KES ${Number(Math.min(Number(emp.house_allowance), p.nonTaxableAllowances)).toLocaleString('en-KE', {maximumFractionDigits:0})}`} sub />}
          </>}
          {Number(emp.transport_allowance) > 0 && <>
            <Row label="Transport Allowance" val={KES(emp.transport_allowance)} />
          </>}
          {Number(emp.other_allowances) > 0 && <Row label="Other Allowances (Taxable)" val={KES(emp.other_allowances)} />}
          <Row label="Total Gross" val={KES(p.totalGross)} bold />
          <Row label="Non-Taxable Allowances" val={`− ${KES(p.nonTaxableAllowances)}`} sub />
          <Row label="Taxable Gross" val={KES(p.taxableGross)} />
        </div>

        {/* Statutory Deductions */}
        <div className="px-4 py-3 bg-red-50">
          <div className="font-medium text-gray-500 mb-1.5 text-xs uppercase tracking-wider">Statutory Deductions (Employee)</div>
          {p.nssfEmployee > 0
            ? <Row label={`NSSF — on basic KES ${Number(p.pensionablePay).toLocaleString('en-KE', {maximumFractionDigits:0})}`} val={KES(p.nssfEmployee)} neg />
            : <Row label="NSSF" val="Exempt" sub />}
          {p.shifEmployee > 0
            ? <Row label="SHIF (2.75% of gross)" val={KES(p.shifEmployee)} neg />
            : <Row label="SHIF" val="Exempt" sub />}
          {p.ahlEmployee > 0
            ? <Row label="AHL (1.5% of gross, tax-deductible)" val={KES(p.ahlEmployee)} neg />
            : <Row label="AHL" val="Exempt" sub />}
        </div>

        {/* PAYE computation */}
        <div className="px-4 py-3 bg-orange-50">
          <div className="font-medium text-gray-500 mb-1.5 text-xs uppercase tracking-wider">PAYE Computation</div>
          <Row label="Taxable Gross" val={KES(p.taxableGross)} />
          {p.nssfEmployee > 0 && <Row label="Less: NSSF" val={`− ${KES(p.nssfEmployee)}`} sub />}
          {p.ahlEmployee  > 0 && <Row label="Less: AHL"  val={`− ${KES(p.ahlEmployee)}`}  sub />}
          <Row label="Taxable Income" val={KES(p.taxableIncome)} bold />
          <Row label="Gross PAYE" val={KES(p.grossPaye)} />
          <Row label="Personal Relief" val={`− ${KES(p.personalRelief)}`} sub />
          {hasReliefs && <>
            {p.disabilityRelief    > 0 && <Row label="Disability Relief"     val={`− ${KES(p.disabilityRelief)}`}         sub />}
            {p.insuranceReliefApplied > 0 && <Row label="Insurance Relief (15%)" val={`− ${KES(p.insuranceReliefApplied)}`} sub />}
            {p.mortgageReliefApplied  > 0 && <Row label="Mortgage Interest Relief" val={`− ${KES(p.mortgageReliefApplied)}`} sub />}
            {p.pensionReliefApplied   > 0 && <Row label="Pension Relief"     val={`− ${KES(p.pensionReliefApplied)}`}    sub />}
            {p.postRetirementApplied  > 0 && <Row label="Post-Retirement Relief" val={`− ${KES(p.postRetirementApplied)}`} sub />}
          </>}
          <Row label="PAYE" val={KES(p.paye)} neg bold />
        </div>

        {/* Voluntary deductions — always shown, highlighted in amber when active */}
        <div className="px-4 py-3 border-t border-dashed border-amber-200 bg-amber-50/40">
          <div className="font-medium text-amber-700 mb-1.5 text-xs uppercase tracking-wider flex items-center gap-1.5">
            <span>⚡</span> Voluntary Deductions
            {!hasVoluntary && <span className="text-gray-400 font-normal normal-case">(none set)</span>}
          </div>
          <Row label="HELB"             val={p.helbDeduction    > 0 ? KES(p.helbDeduction)    : '—'} neg={p.helbDeduction    > 0} />
          <Row label="SACCO"            val={p.saccoDeduction   > 0 ? KES(p.saccoDeduction)   : '—'} neg={p.saccoDeduction   > 0} />
          <Row label="Loan Repayment"   val={p.loanDeduction    > 0 ? KES(p.loanDeduction)    : '—'} neg={p.loanDeduction    > 0} />
          <Row label="Salary Advance"   val={p.advanceDeduction > 0 ? KES(p.advanceDeduction) : '—'} neg={p.advanceDeduction > 0} />
          <Row label="Other Deductions" val={p.otherDeductions  > 0 ? KES(p.otherDeductions)  : '—'} neg={p.otherDeductions  > 0} />
        </div>

        {/* Net Pay */}
        <div className="px-4 py-3 bg-teal-50">
          <Row label="Total Deductions" val={KES(p.totalDeductions)} neg />
          <Row label="NET PAY" val={KES(p.netPay)} bold large />
        </div>

        {/* Employer costs */}
        <div className="px-4 py-3 bg-gray-50 text-xs text-gray-500">
          <div className="font-medium mb-1">Employer Statutory Costs</div>
          {p.nssfEmployer > 0 && <Row label="NSSF (Employer)" val={KES(p.nssfEmployer)} />}
          {p.ahlEmployer  > 0 && <Row label="AHL (Employer 1.5%)" val={KES(p.ahlEmployer)} />}
          {p.nita > 0 && <Row label="NITA Levy" val={KES(p.nita)} />}
          <Row label="Total Employer Cost" val={KES(p.totalEmployerCost)} bold />
        </div>
      </div>
    </div>
  );
}

function Row({ label, val, bold, neg, large, sub }: { label: string; val: string; bold?: boolean; neg?: boolean; large?: boolean; sub?: boolean }) {
  return (
    <div className={`flex justify-between py-0.5 ${large ? 'text-base' : sub ? 'text-xs' : 'text-sm'}`}>
      <span className={sub ? 'text-gray-400 pl-3' : 'text-gray-600'}>{label}</span>
      <span className={`font-${bold ? 'bold' : 'medium'} ${neg ? 'text-red-600' : sub ? 'text-gray-400' : 'text-gray-800'}`}>{val}</span>
    </div>
  );
}

// ─── Employee Form ────────────────────────────────────────────────────────────

const EMPTY_EMP = {
  full_name: '', national_id: '', kra_pin: '', nssf_number: '', shif_number: '',
  phone: '', email: '', bank_name: '', bank_account: '', mpesa_number: '',
  preferred_payment_channel: 'bank_transfer',
  employment_type: 'full_time', job_title: '', department: '', property_id: '',
  gross_salary: '', house_allowance: '0', transport_allowance: '0', other_allowances: '0',
  helb_deduction: '0', sacco_deduction: '0', loan_deduction: '0', other_deductions: '0',
  start_date: new Date().toISOString().slice(0, 10), end_date: '', notes: '',
  // Statutory exemptions
  exempt_nssf: false, exempt_shif: false, exempt_ahl: false, exempt_nita: false,
  // Tax reliefs
  disability_exemption: false,
  insurance_relief: '0', mortgage_relief: '0', pension_relief: '0', post_retirement_relief: '0',
  // Non-taxable overrides (empty = use KRA defaults: house 3000, transport 2000)
  house_allowance_taxable_override: '', transport_allowance_taxable_override: '',
};

function EmployeeForm({ initial, onSave, onClose }: {
  initial?: Partial<typeof EMPTY_EMP>;
  onSave: (data: typeof EMPTY_EMP) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({ ...EMPTY_EMP, ...initial });
  const set  = (k: string) => (e: { target: { value: string } }) => setForm((f: typeof EMPTY_EMP) => ({ ...f, [k]: e.target.value }));
  const setB = (k: string) => (v: boolean) => setForm((f: typeof EMPTY_EMP) => ({ ...f, [k]: v }));

  const Toggle = ({ label, field, hint }: { label: string; field: string; hint?: string }) => (
    <label className="flex items-start gap-2 cursor-pointer">
      <input type="checkbox" className="mt-0.5 accent-teal-600"
        checked={!!(form as any)[field]}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setB(field)(e.target.checked)} />
      <div>
        <span className="text-sm font-medium text-gray-700">{label}</span>
        {hint && <div className="text-xs text-gray-400">{hint}</div>}
      </div>
    </label>
  );

  return (
    <div className="space-y-5">
      {/* Personal */}
      <div>
        <div className="text-xs font-semibold uppercase text-gray-500 tracking-wider mb-3">Personal Details</div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
            <input className={inputCls} value={form.full_name} onChange={set('full_name')} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">National ID</label>
            <input className={inputCls} value={form.national_id} onChange={set('national_id')} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">KRA PIN</label>
            <input className={inputCls} value={form.kra_pin} onChange={set('kra_pin')} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">NSSF Number</label>
            <input className={inputCls} value={form.nssf_number} onChange={set('nssf_number')} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">SHIF Number</label>
            <input className={inputCls} value={form.shif_number} onChange={set('shif_number')} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input className={inputCls} value={form.phone} onChange={set('phone')} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input className={inputCls} type="email" value={form.email} onChange={set('email')} /></div>
        </div>
      </div>

      {/* Employment */}
      <div>
        <div className="text-xs font-semibold uppercase text-gray-500 tracking-wider mb-3">Employment</div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Job Title *</label>
            <input className={inputCls} value={form.job_title} onChange={set('job_title')} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
            <input className={inputCls} value={form.department} onChange={set('department')} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Employment Type</label>
            <select className={selectCls} value={form.employment_type} onChange={set('employment_type')}>
              <option value="full_time">Full Time</option>
              <option value="part_time">Part Time</option>
              <option value="contract">Contract</option>
              <option value="casual">Casual</option>
            </select>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Start Date *</label>
            <input type="date" className={inputCls} value={form.start_date} onChange={set('start_date')} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
            <input type="date" className={inputCls} value={form.end_date} onChange={set('end_date')} /></div>
        </div>
      </div>

      {/* Salary */}
      <div>
        <div className="text-xs font-semibold uppercase text-gray-500 tracking-wider mb-3">Salary & Allowances</div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><label className="block text-sm font-medium text-gray-700 mb-1">Basic Salary (KES) * <span className="text-gray-400 font-normal">— NSSF computed on this only</span></label>
            <input type="number" className={inputCls} value={form.gross_salary} onChange={set('gross_salary')} /></div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">House Allowance</label>
            <input type="number" className={inputCls} value={form.house_allowance} onChange={set('house_allowance')} />
            <div className="text-xs text-gray-400 mt-1">First KES 3,000 non-taxable (KRA default)</div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Transport Allowance</label>
            <input type="number" className={inputCls} value={form.transport_allowance} onChange={set('transport_allowance')} />
            <div className="text-xs text-gray-400 mt-1">First KES 2,000 non-taxable (KRA default)</div>
          </div>
          <div className="col-span-2"><label className="block text-sm font-medium text-gray-700 mb-1">Other Allowances <span className="text-gray-400 font-normal">(fully taxable)</span></label>
            <input type="number" className={inputCls} value={form.other_allowances} onChange={set('other_allowances')} /></div>
        </div>
        {(Number(form.house_allowance) > 0 || Number(form.transport_allowance) > 0) && (
          <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
            <div className="text-xs font-semibold text-blue-700 mb-2">Non-Taxable Override <span className="font-normal">(leave blank to use KRA defaults)</span></div>
            <div className="grid grid-cols-2 gap-3">
              {Number(form.house_allowance) > 0 && (
                <div><label className="block text-xs font-medium text-gray-600 mb-1">Max non-taxable house allowance (KES)</label>
                  <input type="number" className={inputCls} placeholder="Default: 3,000"
                    value={form.house_allowance_taxable_override} onChange={set('house_allowance_taxable_override')} /></div>
              )}
              {Number(form.transport_allowance) > 0 && (
                <div><label className="block text-xs font-medium text-gray-600 mb-1">Max non-taxable transport allowance (KES)</label>
                  <input type="number" className={inputCls} placeholder="Default: 2,000"
                    value={form.transport_allowance_taxable_override} onChange={set('transport_allowance_taxable_override')} /></div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Statutory Exemptions */}
      <div>
        <div className="text-xs font-semibold uppercase text-gray-500 tracking-wider mb-3">Statutory Exemptions</div>
        <div className="p-3 bg-amber-50 rounded-lg border border-amber-100 grid grid-cols-2 gap-3">
          <Toggle field="exempt_nssf" label="Exempt from NSSF" hint="Casual workers, some contracts" />
          <Toggle field="exempt_shif" label="Exempt from SHIF" hint="Casual / exempt category" />
          <Toggle field="exempt_ahl"  label="Exempt from AHL"  hint="Affordable Housing Levy" />
          <Toggle field="exempt_nita" label="Exempt from NITA" hint="KES 50/mo employer levy" />
        </div>
      </div>

      {/* Tax Reliefs */}
      <div>
        <div className="text-xs font-semibold uppercase text-gray-500 tracking-wider mb-3">Tax Reliefs <span className="normal-case font-normal text-gray-400">(reduce PAYE — personal relief KES 2,400 auto-applied)</span></div>
        <div className="p-3 bg-purple-50 rounded-lg border border-purple-100 space-y-3">
          <Toggle field="disability_exemption" label="Person with Disability (PWD)" hint="Extra KES 2,400/mo — requires NCPWD certificate" />
          <div className="grid grid-cols-2 gap-3 mt-2">
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Insurance Premium/mo (KES) <span className="text-gray-400">— relief = 15%, max KES 5,000</span></label>
              <input type="number" className={inputCls} value={form.insurance_relief} onChange={set('insurance_relief')} /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Mortgage Interest/mo (KES) <span className="text-gray-400">— max KES 25,000</span></label>
              <input type="number" className={inputCls} value={form.mortgage_relief} onChange={set('mortgage_relief')} /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Pension Contribution/mo (KES) <span className="text-gray-400">— max KES 30,000</span></label>
              <input type="number" className={inputCls} value={form.pension_relief} onChange={set('pension_relief')} /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Post-Retirement Medical/mo (KES) <span className="text-gray-400">— max KES 10,000</span></label>
              <input type="number" className={inputCls} value={form.post_retirement_relief} onChange={set('post_retirement_relief')} /></div>
          </div>
        </div>
      </div>

      {/* Voluntary Deductions */}
      <div>
        <div className="text-xs font-semibold uppercase text-gray-500 tracking-wider mb-3">Voluntary Deductions</div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">HELB</label>
            <input type="number" className={inputCls} value={form.helb_deduction} onChange={set('helb_deduction')} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">SACCO</label>
            <input type="number" className={inputCls} value={form.sacco_deduction} onChange={set('sacco_deduction')} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Loan Repayment</label>
            <input type="number" className={inputCls} value={form.loan_deduction} onChange={set('loan_deduction')} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Other Deductions</label>
            <input type="number" className={inputCls} value={form.other_deductions} onChange={set('other_deductions')} /></div>
        </div>
      </div>

      {/* Payment */}
      <div>
        <div className="text-xs font-semibold uppercase text-gray-500 tracking-wider mb-3">Payment Details</div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Payment Channel</label>
            <select className={selectCls} value={form.preferred_payment_channel} onChange={set('preferred_payment_channel')}>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="mpesa">M-Pesa</option>
              <option value="cash">Cash</option>
            </select>
          </div>
          {form.preferred_payment_channel === 'bank_transfer' && <>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Bank Name</label>
              <input className={inputCls} value={form.bank_name} onChange={set('bank_name')} /></div>
            <div className="col-span-2"><label className="block text-sm font-medium text-gray-700 mb-1">Bank Account</label>
              <input className={inputCls} value={form.bank_account} onChange={set('bank_account')} /></div>
          </>}
          {form.preferred_payment_channel === 'mpesa' && (
            <div><label className="block text-sm font-medium text-gray-700 mb-1">M-Pesa Number</label>
              <input className={inputCls} value={form.mpesa_number} onChange={set('mpesa_number')} /></div>
          )}
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-medium hover:bg-gray-50">Cancel</button>
        <button onClick={() => onSave(form as any)} className="flex-1 px-4 py-2.5 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700">Save Employee</button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PayrollPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const role = user?.role;
  const canEdit   = role === 'owner' || role === 'finance';
  const canApprove = role === 'owner' || role === 'finance';

  const [tab, setTab]               = useState<'employees' | 'runs' | 'advances' | 'archived'>('employees');
  const [showEmpForm, setShowEmpForm] = useState(false);
  const [editEmp, setEditEmp]       = useState<Employee | null>(null);
  const [confirmDeleteEmp, setConfirmDeleteEmp] = useState<Employee | null>(null);
  const [expandEmp, setExpandEmp]   = useState<string | null>(null);
  const [expandRun, setExpandRun]   = useState<string | null>(null);
  const [runMonth, setRunMonth]     = useState(CURRENT_MONTH);
  const [advEmpId, setAdvEmpId]     = useState('');
  const [advAmount, setAdvAmount]   = useState('');
  const [advMonths, setAdvMonths]   = useState('1');
  const [advReason, setAdvReason]   = useState('');
  const [err, setErr]               = useState('');

  // Queries
  const employees = useQuery({ queryKey: ['employees'], queryFn: () => apiClient.get('/payroll/employees').then((r: any) => r.data.data as Employee[]) });
  const runs      = useQuery({ queryKey: ['payroll-runs'], queryFn: () => apiClient.get('/payroll/runs').then((r: any) => r.data.data as PayrollRun[]) });
  const advances  = useQuery({ queryKey: ['advances'], queryFn: () => apiClient.get('/payroll/advances').then((r: any) => r.data.data as Advance[]) });
  const summary   = useQuery({ queryKey: ['payroll-summary'], queryFn: () => apiClient.get('/payroll/summary').then((r: any) => r.data.data) });
  const runDetail = useQuery({
    queryKey: ['run-detail', expandRun],
    enabled: !!expandRun,
    queryFn: () => apiClient.get(`/payroll/runs/${expandRun}`).then((r: any) => r.data.data as { run: PayrollRun; items: PayrollItem[] }),
  });

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['employees'] }); qc.invalidateQueries({ queryKey: ['payroll-runs'] }); qc.invalidateQueries({ queryKey: ['advances'] }); qc.invalidateQueries({ queryKey: ['payroll-summary'] }); };

  // Mutations
  const saveEmp = useMutation({
    mutationFn: (data: any) => editEmp
      ? apiClient.patch(`/payroll/employees/${editEmp.id}`, data)
      : apiClient.post('/payroll/employees', data),
    onSuccess: () => { invalidate(); setShowEmpForm(false); setEditEmp(null); setErr(''); },
    onError:   (e: any) => setErr(getApiErrorMessage(e)),
  });

  const deleteEmp = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/payroll/employees/${id}`),
    onSuccess: () => { invalidate(); setConfirmDeleteEmp(null); setExpandEmp(null); setErr(''); },
    onError:   (e: any) => setErr(getApiErrorMessage(e)),
  });

  const createRun = useMutation({
    mutationFn: () => apiClient.post('/payroll/runs', { payroll_month: runMonth + '-01' }),
    onSuccess: (res: any) => { invalidate(); setExpandRun(res.data.data.run.id); setTab('runs'); setErr(''); },
    onError:   (e: any) => {
      const msg = getApiErrorMessage(e);
      if ((e as any)?.response?.status === 409) {
        setErr('⚠️ ' + msg + ' Cancel the existing run first, then try again.');
      } else {
        setErr(msg);
      }
    },
  });

  const approveRun = useMutation({
    mutationFn: (id: string) => apiClient.post(`/payroll/runs/${id}/approve`),
    onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ['run-detail', expandRun] }); },
    onError:   (e: any) => setErr(getApiErrorMessage(e)),
  });

  const markPaid = useMutation({
    mutationFn: (id: string) => apiClient.post(`/payroll/runs/${id}/mark-paid`),
    onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ['run-detail', expandRun] }); },
    onError:   (e: any) => setErr(getApiErrorMessage(e)),
  });

  const cancelRun = useMutation({
    mutationFn: (id: string) => apiClient.post(`/payroll/runs/${id}/cancel`),
    onSuccess: () => { invalidate(); setExpandRun(null); },
    onError:   (e: any) => setErr(getApiErrorMessage(e)),
  });


  const archiveRun = useMutation({
    mutationFn: (id: string) => apiClient.post(`/payroll/runs/${id}/archive`),
    onSuccess: () => { invalidate(); setExpandRun(null); toast('Run archived successfully', 'success'); setTab('archived'); },
    onError:   (e: any) => setErr(getApiErrorMessage(e)),
  });

  const createAdvance = useMutation({
    mutationFn: () => apiClient.post('/payroll/advances', {
      employee_id: advEmpId, amount: Number(advAmount),
      repayment_months: Number(advMonths), reason: advReason,
    }),
    onSuccess: () => { invalidate(); setAdvEmpId(''); setAdvAmount(''); setAdvMonths('1'); setAdvReason(''); setErr(''); },
    onError:   (e: any) => setErr(getApiErrorMessage(e)),
  });

  const disburseAdvance = useMutation({
    mutationFn: (id: string) => apiClient.post(`/payroll/advances/${id}/disburse`),
    onSuccess: () => invalidate(),
    onError:   (e: any) => setErr(getApiErrorMessage(e)),
  });

  const s = summary.data;

  return (
    <div className="p-6 ">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payroll</h1>
          <p className="text-sm text-gray-500 mt-0.5">Kenya statutory payroll — PAYE · NSSF · SHIF · AHL · NITA</p>
        </div>
        {canEdit && tab === 'employees' && (
          <button onClick={() => { setEditEmp(null); setShowEmpForm(true); }}
            className="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700">
            + Add Employee
          </button>
        )}
        {canEdit && (tab === 'runs') && (
          <div className="flex items-center gap-2">
            <input type="month" className="px-3 py-2 rounded-lg border text-sm" value={runMonth} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRunMonth(e.target.value)} />
            <button onClick={() => createRun.mutate()}
              disabled={createRun.isPending}
              className="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-70 disabled:cursor-not-allowed flex items-center gap-2 min-w-[140px] justify-center">
              {createRun.isPending ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Generating…
                </>
              ) : 'Generate Run'}
            </button>
            {createRun.isPending && (
              <span className="text-xs text-gray-500 animate-pulse">Calculating payslips, please wait…</span>
            )}
          </div>
        )}
      </div>

      {/* Summary cards */}
      {s && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Active Employees', val: s.active_employees, icon: '👥' },
            { label: 'Last Payroll Net', val: s.last_payroll_net ? KES(s.last_payroll_net) : '—', sub: s.last_payroll_month ? fmtMonth(s.last_payroll_month) : undefined, icon: '💰' },
            { label: 'Pending Runs', val: s.pending_runs, icon: '⏳' },
            { label: 'Advances Outstanding', val: s.total_advance_outstanding ? KES(s.total_advance_outstanding) : 'KES 0', icon: '📋' },
          ].map(c => (
            <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-lg mb-1">{c.icon}</div>
              <div className="text-xl font-bold text-gray-900">{c.val}</div>
              <div className="text-xs text-gray-500">{c.label}</div>
              {c.sub && <div className="text-xs text-gray-400 mt-0.5">{c.sub}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDeleteEmp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6">
            <div className="text-center mb-4">
              <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-2xl mx-auto mb-3">🗑</div>
              <h3 className="font-bold text-gray-900 text-lg">Delete Employee?</h3>
              <p className="text-sm text-gray-500 mt-1">
                <span className="font-semibold text-gray-800">{confirmDeleteEmp.full_name}</span> will be removed from payroll.
                Their historical payslip records will be preserved.
              </p>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setConfirmDeleteEmp(null)}
                className="flex-1 px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-medium hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={() => deleteEmp.mutate(confirmDeleteEmp.id)}
                disabled={deleteEmp.isPending}
                className="flex-1 px-4 py-2.5 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50">
                {deleteEmp.isPending ? 'Deleting…' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {err && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{err} <button onClick={() => setErr('')} className="ml-2 text-red-400 hover:text-red-600">✕</button></div>}

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-gray-100 rounded-lg p-1 w-fit">
        {(['employees', 'runs', 'advances', 'archived'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium capitalize transition-colors ${tab === t ? 'bg-white shadow text-teal-700' : 'text-gray-600 hover:text-gray-800'}`}>
            {t === 'runs' ? 'Payroll Runs' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* ── EMPLOYEES TAB ── */}
      {tab === 'employees' && (
        <>
          {showEmpForm && (
            <div className="mb-5 bg-white rounded-xl border border-teal-200 p-5">
              <h3 className="font-semibold text-gray-900 mb-4">{editEmp ? 'Edit Employee' : 'New Employee'}</h3>
              <EmployeeForm
                initial={editEmp ? { full_name: editEmp.full_name, job_title: editEmp.job_title, department: editEmp.department, national_id: editEmp.national_id, kra_pin: editEmp.kra_pin, nssf_number: editEmp.nssf_number, shif_number: editEmp.shif_number, phone: editEmp.phone, email: editEmp.email, bank_name: editEmp.bank_name, bank_account: editEmp.bank_account, mpesa_number: editEmp.mpesa_number, preferred_payment_channel: editEmp.preferred_payment_channel, employment_type: editEmp.employment_type, gross_salary: editEmp.gross_salary, house_allowance: editEmp.house_allowance, transport_allowance: editEmp.transport_allowance, other_allowances: editEmp.other_allowances, helb_deduction: editEmp.helb_deduction, sacco_deduction: editEmp.sacco_deduction, loan_deduction: editEmp.loan_deduction, other_deductions: editEmp.other_deductions, start_date: editEmp.start_date } : undefined}
                onSave={(data) => saveEmp.mutate({
                  ...data,
                  gross_salary:         Number(data.gross_salary),
                  house_allowance:      Number(data.house_allowance),
                  transport_allowance:  Number(data.transport_allowance),
                  other_allowances:     Number(data.other_allowances),
                  helb_deduction:       Number(data.helb_deduction),
                  sacco_deduction:      Number(data.sacco_deduction),
                  loan_deduction:       Number(data.loan_deduction),
                  other_deductions:     Number(data.other_deductions),
                  insurance_relief:     Number(data.insurance_relief),
                  mortgage_relief:      Number(data.mortgage_relief),
                  pension_relief:       Number(data.pension_relief),
                  post_retirement_relief: Number(data.post_retirement_relief),
                  house_allowance_taxable_override:     data.house_allowance_taxable_override !== '' ? Number(data.house_allowance_taxable_override) : null,
                  transport_allowance_taxable_override: data.transport_allowance_taxable_override !== '' ? Number(data.transport_allowance_taxable_override) : null,
                })}
                onClose={() => { setShowEmpForm(false); setEditEmp(null); }}
              />
            </div>
          )}

          <div className="space-y-3">
            {employees.data?.map((emp: Employee) => (
              <div key={emp.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50"
                  onClick={() => setExpandEmp(expandEmp === emp.id ? null : emp.id)}>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center font-bold text-sm">
                      {emp.full_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900">{emp.full_name}</div>
                      <div className="text-xs text-gray-500">{emp.job_title}{emp.department ? ` · ${emp.department}` : ''}{emp.property_name ? ` · ${emp.property_name}` : ''}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right hidden sm:block">
                      <div className="font-semibold text-gray-900">{KES(emp.gross_salary)}</div>
                      <div className="text-xs text-gray-400">gross/month</div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${emp.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {emp.is_active ? 'Active' : 'Inactive'}
                    </span>
                    {canEdit && (
                      <div className="flex items-center gap-1">
                        <button onClick={(e: React.MouseEvent) => { e.stopPropagation(); setEditEmp(emp); setShowEmpForm(true); setExpandEmp(null); }}
                          className="text-xs text-teal-600 hover:text-teal-800 font-medium px-2">Edit</button>
                        <button onClick={(e: React.MouseEvent) => { e.stopPropagation(); setConfirmDeleteEmp(emp); }}
                          className="text-xs text-red-500 hover:text-red-700 font-medium px-2">Delete</button>
                      </div>
                    )}
                    <span className="text-gray-400">{expandEmp === emp.id ? '▲' : '▼'}</span>
                  </div>
                </div>
                {expandEmp === emp.id && (
                  <div className="border-t border-gray-100 px-4 py-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-4">
                      <div><span className="text-gray-500">Employment</span><br/><span className="font-medium capitalize">{emp.employment_type.replace('_',' ')}</span></div>
                      <div><span className="text-gray-500">Payment</span><br/><span className="font-medium capitalize">{emp.preferred_payment_channel.replace('_',' ')}</span></div>
                      {emp.bank_name && <div><span className="text-gray-500">Bank</span><br/><span className="font-medium">{emp.bank_name} {emp.bank_account}</span></div>}
                      {emp.mpesa_number && <div><span className="text-gray-500">M-Pesa</span><br/><span className="font-medium">{emp.mpesa_number}</span></div>}
                      {emp.kra_pin && <div><span className="text-gray-500">KRA PIN</span><br/><span className="font-medium">{emp.kra_pin}</span></div>}
                      {emp.nssf_number && <div><span className="text-gray-500">NSSF</span><br/><span className="font-medium">{emp.nssf_number}</span></div>}
                    </div>
                    <PayslipPreview emp={emp} />
                  </div>
                )}
              </div>
            ))}
            {employees.data?.length === 0 && (
              <div className="text-center py-16 text-gray-400">
                <div className="text-4xl mb-3">👥</div>
                <div className="font-medium">No employees yet</div>
                <div className="text-sm mt-1">Add your first employee to start running payroll</div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── PAYROLL RUNS TAB ── */}
      {(tab === 'runs' || tab === 'archived') && (
        <div className="space-y-3">
          {(runs.data ?? []).filter((r: PayrollRun) => tab === 'archived' ? r.status === 'archived' : r.status !== 'archived').map((run: PayrollRun) => (
            <div key={run.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50"
                onClick={() => setExpandRun(expandRun === run.id ? null : run.id)}>
                <div>
                  <div className="font-semibold text-gray-900">{fmtMonth(run.payroll_month)}</div>
                  <div className="text-xs text-gray-500">{run.employee_count} employees · Created by {run.created_by_name}</div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right hidden sm:block">
                    <div className="font-semibold text-gray-900">{KES(run.total_net)}</div>
                    <div className="text-xs text-gray-400">net pay</div>
                  </div>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[run.status]}`}>
                    {run.status.toUpperCase()}
                  </span>
                  <span className="text-gray-400">{expandRun === run.id ? '▲' : '▼'}</span>
                </div>
              </div>

              {expandRun === run.id && runDetail.data && runDetail.data.run.id === run.id && (
                <div className="border-t border-gray-100">
                  {/* Summary row */}
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 px-4 py-3 bg-gray-50 text-sm">
                    {[
                      { label: 'Total Gross', val: KES(run.total_gross) },
                      { label: 'Total PAYE', val: KES(run.total_paye) },
                      { label: 'Total NSSF (Emp)', val: KES(run.total_nssf_employee) },
                      { label: 'Total SHIF', val: KES(run.total_shif) },
                      { label: 'Total AHL', val: KES(run.total_ahl_employee) },
                      { label: 'Total Net Pay', val: KES(run.total_net) },
                    ].map(c => (
                      <div key={c.label}>
                        <div className="text-xs text-gray-500">{c.label}</div>
                        <div className="font-semibold text-gray-900">{c.val}</div>
                      </div>
                    ))}
                  </div>

                  {/* Actions */}
                  {run.status === 'draft' && canApprove && (
                    <div className="px-4 py-3 border-b border-gray-100 flex gap-2">
                      <button onClick={() => approveRun.mutate(run.id)}
                        className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">
                        Approve Run
                      </button>
                      <button onClick={() => cancelRun.mutate(run.id)}
                        className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">
                        Cancel
                      </button>
                    </div>
                  )}
                  {run.status === 'approved' && canApprove && (
                    <div className="px-4 py-3 border-b border-gray-100 flex gap-2">
                      <button onClick={() => markPaid.mutate(run.id)}
                        className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700">
                        ✓ Mark as Paid
                      </button>
                      {run.approved_by_name && <span className="text-xs text-gray-500 self-center">Approved by {run.approved_by_name}</span>}
                    </div>
                  )}
                  {run.status === 'cancelled' && (
                    <div className="px-4 py-3 border-b border-gray-100 flex gap-2 items-center">
                      <button onClick={async () => { if (await confirm({ title: 'Archive Payroll Run', message: 'Move this cancelled run to the archive? Archived runs are stored separately and a new run can be created for this month.', confirmLabel: 'Archive', variant: 'warning' })) archiveRun.mutate(run.id); }}
                        disabled={archiveRun.isPending}
                        className="px-4 py-2 rounded-lg border border-amber-200 text-amber-700 bg-amber-50 text-sm font-semibold hover:bg-amber-100 transition">
                        {archiveRun.isPending ? 'Archiving…' : '🗃 Archive Run'}
                      </button>
                      <span className="text-xs text-gray-400 ml-2">Archiving allows you to create a new run for this month</span>
                    </div>
                  )}
                  {run.status === 'paid' && (
                    <div className="px-4 py-3 border-b border-gray-100 text-sm text-green-700 font-medium">
                      ✓ Paid on {run.paid_at ? new Date(run.paid_at).toLocaleDateString('en-KE') : '—'}
                    </div>
                  )}

                  {/* Items table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                          <th className="text-left px-4 py-2">Employee</th>
                          <th className="text-right px-3 py-2">Gross</th>
                          <th className="text-right px-3 py-2">PAYE</th>
                          <th className="text-right px-3 py-2">NSSF</th>
                          <th className="text-right px-3 py-2">SHIF</th>
                          <th className="text-right px-3 py-2">AHL</th>
                          <th className="text-right px-3 py-2">Other</th>
                          <th className="text-right px-4 py-2 font-bold">Net Pay</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {runDetail.data.items.map((item: PayrollItem) => (
                          <tr key={item.id} className="hover:bg-gray-50">
                            <td className="px-4 py-2.5">
                              <div className="font-medium text-gray-900">{item.employee_name}</div>
                              <div className="text-xs text-gray-400">{item.job_title}</div>
                            </td>
                            <td className="text-right px-3 py-2">{KES(item.total_gross)}</td>
                            <td className="text-right px-3 py-2 text-red-600">{KES(item.paye)}</td>
                            <td className="text-right px-3 py-2 text-red-600">{KES(item.nssf_employee)}</td>
                            <td className="text-right px-3 py-2 text-red-600">{KES(item.shif_employee)}</td>
                            <td className="text-right px-3 py-2 text-red-600">{KES(item.ahl_employee)}</td>
                            <td className="text-right px-3 py-2 text-red-600">{KES(Number(item.advance_deduction) + Number(item.nssf_employee === item.nssf_employee ? 0 : 0))}</td>
                            <td className="text-right px-4 py-2 font-bold text-green-700">{KES(item.net_pay)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t-2 border-gray-200 bg-gray-50 font-bold">
                        <tr>
                          <td className="px-4 py-2">TOTAL</td>
                          <td className="text-right px-3 py-2">{KES(run.total_gross)}</td>
                          <td className="text-right px-3 py-2 text-red-600">{KES(run.total_paye)}</td>
                          <td className="text-right px-3 py-2 text-red-600">{KES(run.total_nssf_employee)}</td>
                          <td className="text-right px-3 py-2 text-red-600">{KES(run.total_shif)}</td>
                          <td className="text-right px-3 py-2 text-red-600">{KES(run.total_ahl_employee)}</td>
                          <td className="px-3 py-2"></td>
                          <td className="text-right px-4 py-2 text-green-700">{KES(run.total_net)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* Employer obligations */}
                  <div className="px-4 py-3 bg-amber-50 border-t border-amber-100 text-sm">
                    <div className="font-medium text-amber-800 mb-2">Statutory Remittance Obligations (due 9th of next month)</div>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                      <div><div className="text-amber-600">PAYE → KRA iTax</div><div className="font-bold">{KES(run.total_paye)}</div></div>
                      <div><div className="text-amber-600">NSSF (Emp + Employer)</div><div className="font-bold">{KES(Number(run.total_nssf_employee) + Number(run.total_nssf_employer))}</div></div>
                      <div><div className="text-amber-600">SHIF → SHA</div><div className="font-bold">{KES(run.total_shif)}</div></div>
                      <div><div className="text-amber-600">AHL (Emp + Employer)</div><div className="font-bold">{KES(Number(run.total_ahl_employee) + Number(run.total_ahl_employer))}</div></div>
                      <div><div className="text-amber-600">NITA → NITA Portal</div><div className="font-bold">{KES(run.total_nita)}</div></div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
          {(runs.data ?? []).filter((r: PayrollRun) => tab === 'archived' ? r.status === 'archived' : r.status !== 'archived').length === 0 && (
            <div className="text-center py-16 text-gray-400">
              <div className="text-4xl mb-3">📋</div>
              <div className="font-medium">No payroll runs yet</div>
              <div className="text-sm mt-1">Select a month above and click Generate Run</div>
            </div>
          )}
        </div>
      )}

      {/* ── ADVANCES TAB ── */}
      {tab === 'advances' && (
        <>
          {(canEdit || canApprove) && (
            <div className="mb-5 bg-white rounded-xl border border-teal-200 p-5">
              <h3 className="font-semibold text-gray-900 mb-4">New Salary Advance</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
                  <select className={selectCls} value={advEmpId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setAdvEmpId(e.target.value)}>
                    <option value="">Select employee…</option>
                    {employees.data?.filter((e: Employee) => e.is_active).map((e: Employee) => (
                      <option key={e.id} value={e.id}>{e.full_name} — {e.job_title}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Amount (KES)</label>
                  <input type="number" className={inputCls} value={advAmount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAdvAmount(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Repayment Months</label>
                  <input type="number" min="1" max="24" className={inputCls} value={advMonths} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAdvMonths(e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                  <input className={inputCls} value={advReason} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAdvReason(e.target.value)} />
                </div>
              </div>
              {advAmount && advMonths && (
                <div className="mt-3 text-sm text-teal-700 bg-teal-50 rounded-lg px-3 py-2">
                  Monthly deduction: {KES(Math.ceil(Number(advAmount) / Number(advMonths)))} over {advMonths} month(s)
                </div>
              )}
              <div className="mt-4">
                <button onClick={() => createAdvance.mutate()} disabled={!advEmpId || !advAmount}
                  className="px-5 py-2.5 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-40">
                  Create Advance
                </button>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {advances.data?.map((adv: Advance) => (
              <div key={adv.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-gray-900">{adv.employee_name}</div>
                  <div className="text-xs text-gray-500">{adv.job_title} · {adv.reason || 'No reason stated'}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    {adv.repayment_months} month(s) · {KES(adv.monthly_deduction)}/mo
                    {adv.approved_by_name && ` · Disbursed by ${adv.approved_by_name}`}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="font-bold text-gray-900">{KES(adv.amount)}</div>
                    {Number(adv.remaining_balance) > 0
                      ? <div className="text-xs text-amber-600">Outstanding: {KES(adv.remaining_balance)}</div>
                      : <div className="text-xs text-green-600">Fully repaid ✓</div>
                    }
                  </div>
                  {!adv.is_disbursed && canApprove && (
                    <button onClick={() => disburseAdvance.mutate(adv.id)}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700">
                      Disburse
                    </button>
                  )}
                  {adv.is_disbursed && <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">Disbursed</span>}
                </div>
              </div>
            ))}
            {advances.data?.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <div className="text-3xl mb-3">📋</div>
                <div className="font-medium">No salary advances yet</div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}