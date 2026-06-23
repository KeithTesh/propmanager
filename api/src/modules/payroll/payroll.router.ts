// api/src/modules/payroll/payroll.router.ts

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { withRLS, withRLSTransaction, RLSContext } from '../../db';
import { authenticate, requireRole } from '../../middleware/auth';
import type { ApiResponse } from '../../types';
import { calculatePayroll } from './payroll.engine';
import { alertPayrollRunCreated, alertPayrollApproved, alertPayrollPaid } from '../../lib/alerts';

export const payrollRouter = Router();
payrollRouter.use(authenticate);

function ctx(req: Request): RLSContext {
  return { companyId: req.ctx.companyId!, userId: req.ctx.userId, userRole: req.ctx.userRole };
}

// ─── SCHEMAS ─────────────────────────────────────────────────────────────────

// helper: treat empty string as null
const nullableStr = z.string().optional().nullable().transform((v: string | null | undefined) => v === '' ? null : v ?? null);
const nullableUUID = z.string().uuid().optional().nullable().or(z.literal('').transform((): null => null));

const EmployeeSchema = z.object({
  full_name:              z.string().min(1),
  national_id:            nullableStr,
  kra_pin:                nullableStr,
  nssf_number:            nullableStr,
  shif_number:            nullableStr,
  phone:                  nullableStr,
  email:                  z.string().email().optional().or(z.literal('')).transform((v: string | undefined) => v === '' ? null : v ?? null),
  bank_name:              nullableStr,
  bank_account:           nullableStr,
  mpesa_number:           nullableStr,
  preferred_payment_channel: z.enum(['bank_transfer', 'mpesa', 'cash']).default('bank_transfer'),
  employment_type:        z.enum(['full_time', 'part_time', 'contract', 'casual']).default('full_time'),
  job_title:              z.string().min(1),
  department:             nullableStr,
  property_id:            nullableUUID,
  gross_salary:           z.number().positive(),
  house_allowance:        z.number().min(0).default(0),
  transport_allowance:    z.number().min(0).default(0),
  other_allowances:       z.number().min(0).default(0),
  helb_deduction:         z.number().min(0).default(0),
  sacco_deduction:        z.number().min(0).default(0),
  loan_deduction:         z.number().min(0).default(0),
  other_deductions:       z.number().min(0).default(0),
  start_date:             z.string().min(1),
  end_date:               z.string().optional().nullable().transform((v: string | null | undefined) => v === '' ? null : v ?? null),
  notes:                  nullableStr,
  user_id:                nullableUUID,
  // Statutory exemption flags
  exempt_nssf:            z.boolean().default(false),
  exempt_shif:            z.boolean().default(false),
  exempt_ahl:             z.boolean().default(false),
  exempt_nita:            z.boolean().default(false),
  // Tax reliefs (monthly KES)
  disability_exemption:   z.boolean().default(false),
  insurance_relief:       z.number().min(0).default(0),
  mortgage_relief:        z.number().min(0).default(0),
  pension_relief:         z.number().min(0).default(0),
  post_retirement_relief: z.number().min(0).default(0),
  // Non-taxable allowance overrides (null = use KRA defaults)
  house_allowance_taxable_override:     z.number().min(0).nullable().optional(),
  transport_allowance_taxable_override: z.number().min(0).nullable().optional(),
});

const AdvanceSchema = z.object({
  employee_id:       z.string().uuid(),
  amount:            z.number().positive(),
  reason:            z.string().optional(),
  repayment_months:  z.number().int().min(1).max(24).default(1),
});

// ─── EMPLOYEES ───────────────────────────────────────────────────────────────

// GET /payroll/employees
payrollRouter.get('/employees', requireRole('owner', 'finance'), async (req: Request, res: Response) => {
  const { active, property_id } = req.query;

  const employees = await withRLS(ctx(req), async (db) => db`
    SELECT
      e.*,
      p.name AS property_name,
      u.full_name AS user_full_name
    FROM employees e
    LEFT JOIN properties p ON p.id = e.property_id
    LEFT JOIN users u      ON u.id = e.user_id
    WHERE e.company_id = ${ctx(req).companyId}
      AND e.deleted_at IS NULL
      ${active === 'true' ? db`AND e.is_active = TRUE` : db``}
      ${property_id ? db`AND e.property_id = ${property_id as string}` : db``}
    ORDER BY e.full_name
  `);

  res.json({ success: true, data: employees } satisfies ApiResponse);
});

// GET /payroll/employees/:id
payrollRouter.get('/employees/:id', requireRole('owner', 'finance'), async (req: Request, res: Response) => {
  const [employee] = await withRLS(ctx(req), async (db) => db`
    SELECT e.*, p.name AS property_name
    FROM employees e
    LEFT JOIN properties p ON p.id = e.property_id
    WHERE e.id = ${req.params.id}
      AND e.company_id = ${ctx(req).companyId}
      AND e.deleted_at IS NULL
  `);

  if (!employee) { res.status(404).json({ success: false, error: 'Employee not found' }); return; }

  // also fetch advance balance
  const [advance] = await withRLS(ctx(req), async (db) => db`
    SELECT COALESCE(SUM(remaining_balance), 0) AS outstanding_advances
    FROM salary_advances
    WHERE employee_id = ${req.params.id} AND remaining_balance > 0
  `);

  res.json({ success: true, data: { ...employee, ...advance } } satisfies ApiResponse);
});

// POST /payroll/employees
payrollRouter.post('/employees', requireRole('owner', 'finance'), async (req: Request, res: Response) => {
  const parsed = EmployeeSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, error: parsed.error.issues[0].message }); return; }
  const d = parsed.data;

  const [employee] = await withRLS(ctx(req), async (db) => db`
    INSERT INTO employees (
      company_id, user_id, full_name, national_id, kra_pin, nssf_number, shif_number,
      phone, email, bank_name, bank_account, mpesa_number, preferred_payment_channel,
      employment_type, job_title, department, property_id,
      gross_salary, house_allowance, transport_allowance, other_allowances,
      helb_deduction, sacco_deduction, loan_deduction, other_deductions,
      start_date, end_date, notes, created_by,
      exempt_nssf, exempt_shif, exempt_ahl, exempt_nita,
      disability_exemption, insurance_relief, mortgage_relief, pension_relief, post_retirement_relief,
      house_allowance_taxable_override, transport_allowance_taxable_override
    ) VALUES (
      ${ctx(req).companyId}, ${d.user_id ?? null}, ${d.full_name},
      ${d.national_id ?? null}, ${d.kra_pin ?? null}, ${d.nssf_number ?? null}, ${d.shif_number ?? null},
      ${d.phone ?? null}, ${d.email ?? null}, ${d.bank_name ?? null}, ${d.bank_account ?? null},
      ${d.mpesa_number ?? null}, ${d.preferred_payment_channel},
      ${d.employment_type}, ${d.job_title}, ${d.department ?? null}, ${d.property_id ?? null},
      ${d.gross_salary}, ${d.house_allowance}, ${d.transport_allowance}, ${d.other_allowances},
      ${d.helb_deduction}, ${d.sacco_deduction}, ${d.loan_deduction}, ${d.other_deductions},
      ${d.start_date}, ${d.end_date ?? null}, ${d.notes ?? null}, ${ctx(req).userId},
      ${d.exempt_nssf}, ${d.exempt_shif}, ${d.exempt_ahl}, ${d.exempt_nita},
      ${d.disability_exemption}, ${d.insurance_relief}, ${d.mortgage_relief}, ${d.pension_relief}, ${d.post_retirement_relief},
      ${d.house_allowance_taxable_override ?? null}, ${d.transport_allowance_taxable_override ?? null}
    )
    RETURNING *
  `);

  res.status(201).json({ success: true, data: employee } satisfies ApiResponse);
});

// PATCH /payroll/employees/:id
payrollRouter.patch('/employees/:id', requireRole('owner', 'finance'), async (req: Request, res: Response) => {
  const parsed = EmployeeSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, error: parsed.error.issues[0].message }); return; }
  const d = parsed.data;

  const [employee] = await withRLS(ctx(req), async (db) => db`
    UPDATE employees SET
      full_name              = COALESCE(${d.full_name ?? null}, full_name),
      national_id            = COALESCE(${d.national_id ?? null}, national_id),
      kra_pin                = COALESCE(${d.kra_pin ?? null}, kra_pin),
      nssf_number            = COALESCE(${d.nssf_number ?? null}, nssf_number),
      shif_number            = COALESCE(${d.shif_number ?? null}, shif_number),
      phone                  = COALESCE(${d.phone ?? null}, phone),
      email                  = COALESCE(${d.email ?? null}, email),
      bank_name              = COALESCE(${d.bank_name ?? null}, bank_name),
      bank_account           = COALESCE(${d.bank_account ?? null}, bank_account),
      mpesa_number           = COALESCE(${d.mpesa_number ?? null}, mpesa_number),
      preferred_payment_channel = COALESCE(${d.preferred_payment_channel ?? null}, preferred_payment_channel),
      employment_type        = COALESCE(${d.employment_type ?? null}, employment_type),
      job_title              = COALESCE(${d.job_title ?? null}, job_title),
      department             = COALESCE(${d.department ?? null}, department),
      property_id            = COALESCE(${d.property_id ?? null}, property_id),
      gross_salary           = COALESCE(${d.gross_salary ?? null}, gross_salary),
      house_allowance        = COALESCE(${d.house_allowance ?? null}, house_allowance),
      transport_allowance    = COALESCE(${d.transport_allowance ?? null}, transport_allowance),
      other_allowances       = COALESCE(${d.other_allowances ?? null}, other_allowances),
      helb_deduction         = COALESCE(${d.helb_deduction ?? null}, helb_deduction),
      sacco_deduction        = COALESCE(${d.sacco_deduction ?? null}, sacco_deduction),
      loan_deduction         = COALESCE(${d.loan_deduction ?? null}, loan_deduction),
      other_deductions       = COALESCE(${d.other_deductions ?? null}, other_deductions),
      start_date             = COALESCE(${d.start_date ?? null}, start_date),
      end_date               = COALESCE(${d.end_date ?? null}, end_date),
      notes                  = COALESCE(${d.notes ?? null}, notes),
      exempt_nssf            = COALESCE(${d.exempt_nssf ?? null}, exempt_nssf),
      exempt_shif            = COALESCE(${d.exempt_shif ?? null}, exempt_shif),
      exempt_ahl             = COALESCE(${d.exempt_ahl ?? null}, exempt_ahl),
      exempt_nita            = COALESCE(${d.exempt_nita ?? null}, exempt_nita),
      disability_exemption   = COALESCE(${d.disability_exemption ?? null}, disability_exemption),
      insurance_relief       = COALESCE(${d.insurance_relief ?? null}, insurance_relief),
      mortgage_relief        = COALESCE(${d.mortgage_relief ?? null}, mortgage_relief),
      pension_relief         = COALESCE(${d.pension_relief ?? null}, pension_relief),
      post_retirement_relief = COALESCE(${d.post_retirement_relief ?? null}, post_retirement_relief),
      house_allowance_taxable_override     = ${d.house_allowance_taxable_override ?? null},
      transport_allowance_taxable_override = ${d.transport_allowance_taxable_override ?? null},
      updated_at             = NOW()
    WHERE id = ${req.params.id} AND company_id = ${ctx(req).companyId} AND deleted_at IS NULL
    RETURNING *
  `);

  if (!employee) { res.status(404).json({ success: false, error: 'Employee not found' }); return; }
  res.json({ success: true, data: employee } satisfies ApiResponse);
});

// DELETE /payroll/employees/:id  (soft delete — owner or finance)
payrollRouter.delete('/employees/:id', requireRole('owner', 'finance'), async (req: Request, res: Response) => {
  await withRLS(ctx(req), async (db) => db`
    UPDATE employees SET deleted_at = NOW(), is_active = FALSE
    WHERE id = ${req.params.id} AND company_id = ${ctx(req).companyId}
  `);
  res.json({ success: true, data: { deleted: true } } satisfies ApiResponse);
});

// ─── PAYSLIP PREVIEW ─────────────────────────────────────────────────────────
// Preview a payslip for an employee before creating a run

payrollRouter.get('/employees/:id/payslip-preview', requireRole('owner', 'finance'), async (req: Request, res: Response) => {
  const [emp] = await withRLS(ctx(req), async (db) => db`
    SELECT * FROM employees
    WHERE id = ${req.params.id} AND company_id = ${ctx(req).companyId} AND deleted_at IS NULL
  `);
  if (!emp) { res.status(404).json({ success: false, error: 'Employee not found' }); return; }

  // Get outstanding advance balance for auto-deduction
  const [advRow] = await withRLS(ctx(req), async (db) => db`
    SELECT COALESCE(SUM(monthly_deduction), 0) AS advance_deduction
    FROM salary_advances
    WHERE employee_id = ${req.params.id} AND remaining_balance > 0
  `);

  const result = calculatePayroll({
    grossSalary:        Number(emp.gross_salary),
    houseAllowance:     Number(emp.house_allowance),
    transportAllowance: Number(emp.transport_allowance),
    otherAllowances:    Number(emp.other_allowances),
    houseAllowanceTaxableOverride:     emp.house_allowance_taxable_override != null ? Number(emp.house_allowance_taxable_override) : null,
    transportAllowanceTaxableOverride: emp.transport_allowance_taxable_override != null ? Number(emp.transport_allowance_taxable_override) : null,
    exemptNSSF: emp.exempt_nssf === true,
    exemptSHIF: emp.exempt_shif === true,
    exemptAHL:  emp.exempt_ahl  === true,
    exemptNITA: emp.exempt_nita === true,
    disabilityExemption:  emp.disability_exemption === true,
    insuranceRelief:      Number(emp.insurance_relief ?? 0),
    mortgageRelief:       Number(emp.mortgage_relief ?? 0),
    pensionRelief:        Number(emp.pension_relief ?? 0),
    postRetirementRelief: Number(emp.post_retirement_relief ?? 0),
    helbDeduction:      Number(emp.helb_deduction),
    saccoDeduction:     Number(emp.sacco_deduction),
    loanDeduction:      Number(emp.loan_deduction),
    advanceDeduction:   Number(advRow?.advance_deduction ?? 0),
    otherDeductions:    Number(emp.other_deductions),
  });

  res.json({ success: true, data: { employee: emp, payslip: result } } satisfies ApiResponse);
});

// ─── SALARY ADVANCES ─────────────────────────────────────────────────────────

payrollRouter.get('/advances', requireRole('owner', 'finance'), async (req: Request, res: Response) => {
  const advances = await withRLS(ctx(req), async (db) => db`
    SELECT a.*, e.full_name AS employee_name, e.job_title,
           u.full_name AS approved_by_name
    FROM salary_advances a
    JOIN employees e ON e.id = a.employee_id
    LEFT JOIN users u ON u.id = a.approved_by
    WHERE a.company_id = ${ctx(req).companyId}
    ORDER BY a.created_at DESC
  `);
  res.json({ success: true, data: advances } satisfies ApiResponse);
});

payrollRouter.post('/advances', requireRole('owner', 'finance'), async (req: Request, res: Response) => {
  const parsed = AdvanceSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, error: parsed.error.issues[0].message }); return; }
  const d = parsed.data;

  // Verify employee belongs to company
  const [emp] = await withRLS(ctx(req), async (db) => db`
    SELECT id FROM employees WHERE id = ${d.employee_id}
      AND company_id = ${ctx(req).companyId} AND deleted_at IS NULL
  `);
  if (!emp) { res.status(404).json({ success: false, error: 'Employee not found' }); return; }

  const monthlyDeduction = Math.ceil(d.amount / d.repayment_months);

  const [advance] = await withRLS(ctx(req), async (db) => db`
    INSERT INTO salary_advances (
      company_id, employee_id, amount, reason, repayment_months,
      monthly_deduction, remaining_balance, created_by
    ) VALUES (
      ${ctx(req).companyId}, ${d.employee_id}, ${d.amount}, ${d.reason ?? null},
      ${d.repayment_months}, ${monthlyDeduction}, ${d.amount}, ${ctx(req).userId}
    )
    RETURNING *
  `);

  res.status(201).json({ success: true, data: advance } satisfies ApiResponse);
});

// Approve + disburse advance
payrollRouter.post('/advances/:id/disburse', requireRole('owner', 'finance'), async (req: Request, res: Response) => {
  const [advance] = await withRLS(ctx(req), async (db) => db`
    UPDATE salary_advances SET
      approved_by  = ${ctx(req).userId},
      approved_at  = NOW(),
      is_disbursed = TRUE,
      disbursed_at = NOW()
    WHERE id = ${req.params.id} AND company_id = ${ctx(req).companyId}
      AND is_disbursed = FALSE
    RETURNING *
  `);
  if (!advance) { res.status(404).json({ success: false, error: 'Advance not found or already disbursed' }); return; }
  res.json({ success: true, data: advance } satisfies ApiResponse);
});

// ─── PAYROLL RUNS ─────────────────────────────────────────────────────────────

// GET /payroll/runs
payrollRouter.get('/runs', requireRole('owner', 'finance'), async (req: Request, res: Response) => {
  const runs = await withRLS(ctx(req), async (db) => db`
    SELECT r.*,
      u.full_name AS created_by_name,
      a.full_name AS approved_by_name,
      (SELECT COUNT(*) FROM payroll_items i WHERE i.payroll_run_id = r.id) AS employee_count
    FROM payroll_runs r
    LEFT JOIN users u ON u.id = r.created_by
    LEFT JOIN users a ON a.id = r.approved_by
    WHERE r.company_id = ${ctx(req).companyId}
    ORDER BY r.payroll_month DESC
    LIMIT 24
  `);
  res.json({ success: true, data: runs } satisfies ApiResponse);
});

// GET /payroll/runs/:id
payrollRouter.get('/runs/:id', requireRole('owner', 'finance'), async (req: Request, res: Response) => {
  const [run] = await withRLS(ctx(req), async (db) => db`
    SELECT r.*, u.full_name AS created_by_name, a.full_name AS approved_by_name
    FROM payroll_runs r
    LEFT JOIN users u ON u.id = r.created_by
    LEFT JOIN users a ON a.id = r.approved_by
    WHERE r.id = ${req.params.id} AND r.company_id = ${ctx(req).companyId}
  `);
  if (!run) { res.status(404).json({ success: false, error: 'Payroll run not found' }); return; }

  const items = await withRLS(ctx(req), async (db) => db`
    SELECT i.*, e.full_name AS employee_name, e.job_title, e.department,
           e.bank_name AS emp_bank_name, e.bank_account AS emp_bank_account,
           e.mpesa_number AS emp_mpesa_number, e.preferred_payment_channel
    FROM payroll_items i
    JOIN employees e ON e.id = i.employee_id
    WHERE i.payroll_run_id = ${req.params.id}
    ORDER BY e.full_name
  `);

  res.json({ success: true, data: { run, items } } satisfies ApiResponse);
});

// POST /payroll/runs  — create a draft run for a given month
payrollRouter.post('/runs', requireRole('owner', 'finance'), async (req: Request, res: Response) => {
  const { payroll_month } = z.object({ payroll_month: z.string() }).parse(req.body);
  // Accept either "2025-07" or "2025-07-01" — always normalise to 1st of month
  const monthDate = payroll_month.length === 7 ? payroll_month + '-01' : payroll_month.slice(0, 7) + '-01';

  // Check not already exists (cancelled/archived runs don't block a new one)
  const [existing] = await withRLS(ctx(req), async (db) => db`
    SELECT id, status FROM payroll_runs
    WHERE company_id = ${ctx(req).companyId}
      AND payroll_month = ${monthDate}
      AND status NOT IN ('cancelled', 'archived')
  `);
  if (existing) { res.status(409).json({ success: false, error: `An active payroll run for ${monthDate.slice(0,7)} already exists. Cancel it first before creating a new one.` }); return; }

  // Load all active employees
  const employees = await withRLS(ctx(req), async (db) => db`
    SELECT e.*,
      COALESCE(
        (SELECT SUM(monthly_deduction) FROM salary_advances sa
         WHERE sa.employee_id = e.id AND sa.remaining_balance > 0),
        0
      ) AS advance_deduction
    FROM employees e
    WHERE e.company_id = ${ctx(req).companyId}
      AND e.is_active = TRUE
      AND e.deleted_at IS NULL
      AND e.start_date <= ${monthDate}
      AND (e.end_date IS NULL OR e.end_date >= ${monthDate})
  `);

  if (employees.length === 0) {
    res.status(400).json({
      success: false,
      error: `No active employees found for ${monthDate}. Ensure employees have a start_date on or before this month.`,
    });
    return;
  }

  // Calculate payroll for each employee — fetch real advance balance from salary_advances
  const items: { emp: any; result: any; advanceDeduction: number }[] = [];
  for (const emp of employees) {
    const [advRow] = await withRLS(ctx(req), async (db) => db`
      SELECT COALESCE(SUM(monthly_deduction), 0) AS advance_deduction
      FROM salary_advances
      WHERE employee_id = ${emp.id}
        AND company_id = ${ctx(req).companyId}
        AND remaining_balance > 0
    `);
    const advanceDeduction = Number(advRow?.advance_deduction ?? 0);
    const result = calculatePayroll({
      grossSalary:        Number(emp.gross_salary),
      houseAllowance:     Number(emp.house_allowance),
      transportAllowance: Number(emp.transport_allowance),
      otherAllowances:    Number(emp.other_allowances),
      houseAllowanceTaxableOverride:     emp.house_allowance_taxable_override != null ? Number(emp.house_allowance_taxable_override) : null,
      transportAllowanceTaxableOverride: emp.transport_allowance_taxable_override != null ? Number(emp.transport_allowance_taxable_override) : null,
      exemptNSSF: emp.exempt_nssf === true,
      exemptSHIF: emp.exempt_shif === true,
      exemptAHL:  emp.exempt_ahl  === true,
      exemptNITA: emp.exempt_nita === true,
      disabilityExemption:  emp.disability_exemption === true,
      insuranceRelief:      Number(emp.insurance_relief ?? 0),
      mortgageRelief:       Number(emp.mortgage_relief ?? 0),
      pensionRelief:        Number(emp.pension_relief ?? 0),
      postRetirementRelief: Number(emp.post_retirement_relief ?? 0),
      helbDeduction:     Number(emp.helb_deduction),
      saccoDeduction:    Number(emp.sacco_deduction),
      loanDeduction:     Number(emp.loan_deduction),
      advanceDeduction,
      otherDeductions:   Number(emp.other_deductions),
    });
    items.push({ emp, result, advanceDeduction });
  }

  // Totals
  const totals = items.reduce((acc: any, { result }: any) => ({
    total_gross:          acc.total_gross          + result.totalGross,
    total_net:            acc.total_net            + result.netPay,
    total_paye:           acc.total_paye           + result.paye,
    total_nssf_employee:  acc.total_nssf_employee  + result.nssfEmployee,
    total_nssf_employer:  acc.total_nssf_employer  + result.nssfEmployer,
    total_shif:           acc.total_shif           + result.shifEmployee,
    total_ahl_employee:   acc.total_ahl_employee   + result.ahlEmployee,
    total_ahl_employer:   acc.total_ahl_employer   + result.ahlEmployer,
    total_nita:           acc.total_nita           + result.nita,
  }), {
    total_gross: 0, total_net: 0, total_paye: 0,
    total_nssf_employee: 0, total_nssf_employer: 0, total_shif: 0,
    total_ahl_employee: 0, total_ahl_employer: 0, total_nita: 0,
  });

  // Persist run + items in one transaction
  const run = await withRLSTransaction(ctx(req), async (sql) => {
      const [run] = await sql`
        INSERT INTO payroll_runs (
          company_id, payroll_month, status,
          total_gross, total_net, total_paye,
          total_nssf_employee, total_nssf_employer, total_shif,
          total_ahl_employee, total_ahl_employer, total_nita,
          created_by
        ) VALUES (
          ${ctx(req).companyId}, ${monthDate}, 'draft',
          ${totals.total_gross}, ${totals.total_net}, ${totals.total_paye},
          ${totals.total_nssf_employee}, ${totals.total_nssf_employer}, ${totals.total_shif},
          ${totals.total_ahl_employee}, ${totals.total_ahl_employer}, ${totals.total_nita},
          ${ctx(req).userId}
        )
        RETURNING *
      `;

      // Insert all items
      for (const { emp, result } of items) {
        await sql`
          INSERT INTO payroll_items (
            payroll_run_id, company_id, employee_id,
            gross_salary, house_allowance, transport_allowance, other_allowances, total_gross,
            nssf_employee, shif_employee, ahl_employee, taxable_income, paye,
            helb_deduction, sacco_deduction, loan_deduction, advance_deduction, other_deductions,
            total_deductions, net_pay,
            nssf_employer, ahl_employer, nita,
            payment_channel, bank_name, bank_account, mpesa_number
          ) VALUES (
            ${run.id}, ${ctx(req).companyId}, ${emp.id},
            ${Number(emp.gross_salary)}, ${Number(emp.house_allowance)},
            ${Number(emp.transport_allowance)}, ${Number(emp.other_allowances)},
            ${result.totalGross},
            ${result.nssfEmployee}, ${result.shifEmployee}, ${result.ahlEmployee},
            ${result.taxableIncome}, ${result.paye},
            ${result.helbDeduction}, ${result.saccoDeduction}, ${result.loanDeduction},
            ${result.advanceDeduction}, ${result.otherDeductions},
            ${result.totalDeductions}, ${result.netPay},
            ${result.nssfEmployer}, ${result.ahlEmployer}, ${result.nita},
            ${emp.preferred_payment_channel}, ${emp.bank_name ?? null},
            ${emp.bank_account ?? null}, ${emp.mpesa_number ?? null}
          )
        `;
      }

      return run;
  });

  res.status(201).json({ success: true, data: { run, employee_count: items.length } } satisfies ApiResponse);

  // Alert finance — non-blocking
  const totalNet = items.reduce((s: number, i: any) => s + Number(i.net_pay ?? 0), 0);
  alertPayrollRunCreated(ctx(req), {
    month: run.payroll_month,
    employeeCount: items.length,
    totalNet,
  }).catch(() => {});
});

// POST /payroll/runs/:id/approve  (owner or finance only)
payrollRouter.post('/runs/:id/approve', requireRole('owner', 'finance'), async (req: Request, res: Response) => {
  const [run] = await withRLS(ctx(req), async (db) => db`
    SELECT * FROM payroll_runs
    WHERE id = ${req.params.id} AND company_id = ${ctx(req).companyId}
  `);
  if (!run) { res.status(404).json({ success: false, error: 'Payroll run not found' }); return; }
  if (run.status !== 'draft') {
    res.status(400).json({ success: false, error: `Cannot approve a run in status: ${run.status}` });
    return;
  }
  // Prevent self-approval only if they also created it
  if (run.created_by === ctx(req).userId && req.ctx.userRole !== 'owner') {
    res.status(403).json({ success: false, error: 'You cannot approve a payroll run you created' });
    return;
  }

  const [updated] = await withRLS(ctx(req), async (db) => db`
    UPDATE payroll_runs SET
      status      = 'approved',
      approved_by = ${ctx(req).userId},
      approved_at = NOW(),
      updated_at  = NOW()
    WHERE id = ${req.params.id} AND company_id = ${ctx(req).companyId}
    RETURNING *
  `);

  res.json({ success: true, data: updated } satisfies ApiResponse);

  // Alert owners — non-blocking
  const [approver] = await withRLS(ctx(req), async (db) => db`SELECT full_name FROM users WHERE id = ${ctx(req).userId}`).catch(() => [null]);
  alertPayrollApproved(ctx(req), {
    month: run.payroll_month,
    totalNet: Number(run.total_net_pay ?? 0),
    approvedByName: approver?.full_name ?? 'Finance',
  }).catch(() => {});
});

// POST /payroll/runs/:id/mark-paid  (owner or finance only)
payrollRouter.post('/runs/:id/mark-paid', requireRole('owner', 'finance'), async (req: Request, res: Response) => {
  const [run] = await withRLS(ctx(req), async (db) => db`
    SELECT * FROM payroll_runs WHERE id = ${req.params.id} AND company_id = ${ctx(req).companyId}
  `);
  if (!run) { res.status(404).json({ success: false, error: 'Payroll run not found' }); return; }
  if (run.status !== 'approved') {
    res.status(400).json({ success: false, error: 'Payroll run must be approved before marking as paid' });
    return;
  }

  await withRLSTransaction(ctx(req), async (sql) => {
      // Mark run paid
      await sql`
        UPDATE payroll_runs SET status = 'paid', paid_at = NOW(), paid_by = ${ctx(req).userId}, updated_at = NOW()
        WHERE id = ${run.id}
      `;
      // Mark all items paid
      await sql`
        UPDATE payroll_items SET is_paid = TRUE, paid_at = NOW()
        WHERE payroll_run_id = ${run.id}
      `;
      // Reduce salary advance balances
      const items = await sql`
        SELECT employee_id, advance_deduction FROM payroll_items WHERE payroll_run_id = ${run.id} AND advance_deduction > 0
      `;
      for (const item of items) {
        const advances = await sql`
          SELECT id, remaining_balance, monthly_deduction FROM salary_advances
          WHERE employee_id = ${item.employee_id} AND remaining_balance > 0
          ORDER BY created_at ASC
        `;
        let remaining = Number(item.advance_deduction);
        for (const adv of advances) {
          if (remaining <= 0) break;
          const deduct = Math.min(remaining, Number(adv.remaining_balance));
          const newBal = Number(adv.remaining_balance) - deduct;
          await sql`
            UPDATE salary_advances SET
              remaining_balance = ${newBal},
              fully_repaid_at   = ${newBal === 0 ? new Date() : null}
            WHERE id = ${adv.id}
          `;
          remaining -= deduct;
        }
      }
  });

  res.json({ success: true, data: { paid: true } } satisfies ApiResponse);

  // Alert all staff — non-blocking
  alertPayrollPaid(ctx(req), {
    month: run.payroll_month,
    totalNet: Number(run.total_net_pay ?? 0),
  }).catch(() => {});
});

// POST /payroll/runs/:id/cancel
payrollRouter.post('/runs/:id/cancel', requireRole('owner', 'finance'), async (req: Request, res: Response) => {
  const [updated] = await withRLS(ctx(req), async (db) => db`
    UPDATE payroll_runs SET status = 'cancelled', updated_at = NOW()
    WHERE id = ${req.params.id} AND company_id = ${ctx(req).companyId}
      AND status IN ('draft', 'approved')
    RETURNING *
  `);
  if (!updated) { res.status(404).json({ success: false, error: 'Payroll run not found or cannot be cancelled' }); return; }
  res.json({ success: true, data: updated } satisfies ApiResponse);
});

// ─── PAYROLL SUMMARY (dashboard stats) ───────────────────────────────────────


// POST /payroll/runs/:id/archive — archive a cancelled run (owner or finance)
payrollRouter.post('/runs/:id/archive', requireRole('owner', 'finance'), async (req: Request, res: Response) => {
  const [updated] = await withRLS(ctx(req), async (db) => db`
    UPDATE payroll_runs SET status = 'archived', archived_at = NOW(), updated_at = NOW()
    WHERE id = ${req.params.id}
      AND company_id = ${ctx(req).companyId}
      AND status = 'cancelled'
    RETURNING id
  `);
  if (!updated) { res.status(404).json({ success: false, error: 'Run not found or not in cancelled state' }); return; }
  res.json({ success: true, data: { archived: true } } satisfies ApiResponse);
});

payrollRouter.get('/summary', requireRole('owner', 'finance'), async (req: Request, res: Response) => {
  const [stats] = await withRLS(ctx(req), async (db) => db`
    SELECT
      (SELECT COUNT(*) FROM employees WHERE company_id = ${ctx(req).companyId} AND is_active = TRUE AND deleted_at IS NULL) AS active_employees,
      (SELECT COUNT(*) FROM payroll_runs WHERE company_id = ${ctx(req).companyId} AND status = 'draft') AS pending_runs,
      (SELECT total_net FROM payroll_runs WHERE company_id = ${ctx(req).companyId} AND status = 'paid' ORDER BY payroll_month DESC LIMIT 1) AS last_payroll_net,
      (SELECT payroll_month FROM payroll_runs WHERE company_id = ${ctx(req).companyId} AND status = 'paid' ORDER BY payroll_month DESC LIMIT 1) AS last_payroll_month,
      (SELECT COALESCE(SUM(remaining_balance),0) FROM salary_advances sa JOIN employees e ON e.id = sa.employee_id WHERE e.company_id = ${ctx(req).companyId} AND sa.remaining_balance > 0) AS total_advance_outstanding
  `);
  res.json({ success: true, data: stats } satisfies ApiResponse);
});