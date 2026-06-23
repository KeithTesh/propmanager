// api/src/modules/leases/leases.router.ts

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { withRLS, withRLSTransaction } from '../../db';
import { authenticate } from '../../middleware/auth';
import { NotFoundError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { calculateProration } from '../../lib/prorationEngine';
import type { ApiResponse, RLSContext } from '../../types';

export const leasesRouter = Router();
leasesRouter.use(authenticate);

function ctx(req: Request): RLSContext {
  return { companyId: req.ctx.companyId!, userId: req.ctx.userId, userRole: req.ctx.userRole };
}

// ─── GET /leases ──────────────────────────────────────────────────────────────

leasesRouter.get('/', async (req: Request, res: Response) => {
  const { status, unitId, tenantId } = req.query as Record<string, string | undefined>;

  const leases = await withRLS(ctx(req), async (db) => {
    return db`
      SELECT
        l.*,
        t.full_name        AS tenant_name,
        t.phone            AS tenant_phone,
        u.unit_number,
        p.name             AS property_name,
        p.id               AS property_id,

        -- Outstanding balance
        COALESCE((
          SELECT SUM(mb.total_due)
          FROM monthly_bills mb
          WHERE mb.lease_id = l.id
            AND mb.status IN ('open','partial','overdue')
        ), 0) AS outstanding_balance,

        -- Days until end (for fixed leases)
        CASE WHEN l.end_date IS NOT NULL
          THEN (l.end_date - CURRENT_DATE)
          ELSE NULL
        END AS days_remaining

      FROM leases l
      JOIN tenants t    ON t.id = l.primary_tenant_id
      JOIN units u      ON u.id = l.unit_id
      JOIN properties p ON p.id = u.property_id
      WHERE l.company_id = ${req.ctx.companyId}
                ${status   ? db`AND l.status   = ${status}`    : db``}
        ${unitId   ? db`AND l.unit_id  = ${unitId}`    : db``}
        ${tenantId ? db`AND l.primary_tenant_id = ${tenantId}` : db``}
      ORDER BY l.created_at DESC
    `;
  });

  res.json({ success: true, data: { leases } } satisfies ApiResponse<unknown>);
});

// ─── GET /leases/:id ──────────────────────────────────────────────────────────

leasesRouter.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await withRLS(ctx(req), async (db) => {
    const [lease] = await db`
      SELECT l.*,
        t.full_name AS tenant_name, t.phone AS tenant_phone, t.email AS tenant_email,
        u.unit_number, p.name AS property_name, p.id AS property_id
      FROM leases l
      JOIN tenants t    ON t.id = l.primary_tenant_id
      JOIN units u      ON u.id = l.unit_id
      JOIN properties p ON p.id = u.property_id
      WHERE l.id = ${id} AND l.company_id = ${req.ctx.companyId}
    `;
    if (!lease) return null;

    const bills = await db`
      SELECT * FROM monthly_bills
      WHERE lease_id = ${id}
      ORDER BY for_month DESC
    `;

    const coTenants = await db`
      SELECT lt.*, t.full_name, t.phone
      FROM lease_tenants lt
      JOIN tenants t ON t.id = lt.tenant_id
      WHERE lt.lease_id = ${id} AND lt.removed_at IS NULL
    `;

    return { ...lease, bills, coTenants };
  });

  if (!result) throw new NotFoundError('Lease not found');
  res.json({ success: true, data: { lease: result } } satisfies ApiResponse<unknown>);
});

// ─── POST /leases/preview-proration ───────────────────────────────────────────
// Returns proration preview for the UI before lease is created

leasesRouter.post('/preview-proration', async (req: Request, res: Response) => {
  const { monthlyRent, startDate } = z.object({
    monthlyRent: z.number().positive(),
    startDate:   z.string(),
  }).parse(req.body);

  // Fetch company proration settings
  const [company] = await withRLS(ctx(req), async (db) => {
    return db`
      SELECT move_in_proration_mode, move_in_proration_cutoff,
             move_in_proration_method, min_proration_threshold, due_day
      FROM companies WHERE id = ${req.ctx.companyId}
    `;
  });

  const result = calculateProration({
    monthlyRent,
    moveInDate:            startDate,
    prorationType:         company.move_in_proration_mode    ?? 'never',
    prorationCutoff:       company.move_in_proration_cutoff  ?? null,
    prorationMethod:       company.move_in_proration_method  ?? 'actual_days',
    minProrationThreshold: company.min_proration_threshold   ?? 500,
  });

  res.json({ success: true, data: { proration: result, dueDay: company.due_day ?? 1 } } satisfies ApiResponse<unknown>);
});

// ─── POST /leases ─────────────────────────────────────────────────────────────

const CreateLeaseSchema = z.object({
  unitId:          z.string().uuid(),
  primaryTenantId: z.string().uuid(),
  startDate:       z.string(),
  endDate:         z.string().optional().nullable(),
  monthlyRent:     z.number().positive(),
  depositAmount:   z.number().min(0).default(0),
  noticePeriodDays:z.number().int().min(0).default(30),
  isEmployeeBenefit: z.boolean().optional().default(false),
});

leasesRouter.post('/', async (req: Request, res: Response) => {
  const data      = CreateLeaseSchema.parse(req.body);
  const id        = randomUUID();
  const companyId = req.ctx.companyId!;
  const userId    = req.ctx.userId;

  await withRLSTransaction(ctx(req), async (tx) => {
    // 1. Check unit exists and is vacant
    const [unit] = await tx`
      SELECT u.id, u.is_occupied, u.unit_number, p.name AS property_name
      FROM units u JOIN properties p ON p.id = u.property_id
      WHERE u.id = ${data.unitId} AND u.deleted_at IS NULL
    `;
    if (!unit) throw new Error('Unit not found');
    if (unit.is_occupied) throw new Error(`Unit ${unit.unit_number} is already occupied`);

    // 2. Check no active lease on this unit already
    const [existing] = await tx`
      SELECT id FROM leases
      WHERE unit_id = ${data.unitId} AND company_id = ${req.ctx.companyId} AND status IN ('active','notice','draft')
      LIMIT 1
    `;
    if (existing) throw new Error('Unit already has an active or pending lease');

    // 3. Check tenant exists
    const [tenant] = await tx`
      SELECT id FROM tenants WHERE id = ${data.primaryTenantId} AND deleted_at IS NULL
    `;
    if (!tenant) throw new Error('Tenant not found');

    // 4. Fetch company settings for snapshots
    const [company] = await tx`
      SELECT payment_method, paybill_number, paybill_account_format,
             move_in_proration_mode, move_in_proration_cutoff, move_in_proration_method,
             move_out_proration_mode, bill_first_partial_month, min_proration_threshold,
             due_day
      FROM companies WHERE id = ${companyId}
    `;

    // 5. Build account reference (e.g. "A1-abc123")
    const leaseShort       = id.slice(0, 6).toUpperCase();
    const accountReference = `${unit.unit_number}-${leaseShort}`;

    // 6. Insert lease (status = active immediately)
    await tx`
      INSERT INTO leases (
        id, company_id, unit_id, primary_tenant_id,
        status, start_date, end_date, monthly_rent, deposit_amount,
        notice_period_days, is_employee_benefit,

        snap_move_in_proration_mode,   snap_move_in_proration_cutoff,
        snap_move_in_proration_method, snap_move_out_proration_mode,
        snap_bill_first_partial_month, snap_min_proration_threshold,
        snap_payment_method, snap_paybill_number, snap_account_reference,

        created_by, activated_at
      ) VALUES (
        ${id}, ${companyId}, ${data.unitId}, ${data.primaryTenantId},
        'active', ${data.startDate}, ${data.endDate ?? null},
        ${data.monthlyRent}, ${data.depositAmount},
        ${data.noticePeriodDays}, ${data.isEmployeeBenefit ?? false},

        ${company.move_in_proration_mode   ?? null},
        ${company.move_in_proration_cutoff ?? null},
        ${company.move_in_proration_method ?? null},
        ${company.move_out_proration_mode  ?? null},
        ${company.bill_first_partial_month ?? true},
        ${company.min_proration_threshold  ?? 500},
        ${company.payment_method},
        ${company.paybill_number ?? null},
        ${accountReference},

        ${userId}, NOW()
      )
    `;

    // 7. Insert primary tenant into lease_tenants join table
    await tx`
      INSERT INTO lease_tenants (id, lease_id, tenant_id, company_id, role, is_billing_contact)
      VALUES (${randomUUID()}, ${id}, ${data.primaryTenantId}, ${companyId}, 'primary', true)
    `;

    // 8. Mark unit as occupied
    await tx`
      UPDATE units SET is_occupied = true, updated_at = NOW()
      WHERE id = ${data.unitId}
    `;

    // 9. Generate first (signing) bill with proration
    const proration = calculateProration({
      monthlyRent:           data.monthlyRent,
      moveInDate:            data.startDate,
      prorationType:         company.move_in_proration_mode    ?? 'never',
      prorationCutoff:       company.move_in_proration_cutoff  ?? null,
      prorationMethod:       company.move_in_proration_method  ?? 'actual_days',
      minProrationThreshold: company.min_proration_threshold   ?? 500,
    });

    // Parse date as string to avoid timezone shifts (e.g. '2026-03-08' → March, not Feb)
    const forMonth = data.startDate.slice(0, 7) + '-01';
    const dueDate  = data.startDate; // signing bill due immediately
    const billAmount    = proration.billAmount;
    const billId        = randomUUID();

    if (company.bill_first_partial_month !== false) {
      await tx`
        INSERT INTO monthly_bills (
          id, company_id, lease_id, unit_id,
          for_month, due_date, bill_type,
          rent_amount, status,
          is_prorated, proration_days, proration_days_in_month,
          proration_method, proration_description,
          snap_payment_method, snap_paybill_number, snap_account_reference,
          generated_by, created_by
        ) VALUES (
          ${billId}, ${companyId}, ${id}, ${data.unitId},
          ${forMonth}, ${dueDate}, 'signing',
          ${billAmount}, 'open',
          ${proration.isProrated},
          ${proration.proratedDays ?? null},
          ${proration.daysInMonth  ?? null},
          ${company.move_in_proration_method ?? null},
          ${proration.description},
          ${company.payment_method},
          ${company.paybill_number ?? null},
          ${accountReference},
          'system', ${userId}
        )
      `;

      // Link first bill back to lease
      await tx`
        UPDATE leases
        SET first_bill_generated = true, first_bill_id = ${billId}
        WHERE company_id = ${req.ctx.companyId} AND id = ${id}
      `;
    }

    // Create deposit bill if deposit_amount > 0
    if (data.depositAmount > 0) {
      await tx`
        INSERT INTO monthly_bills (
          id, company_id, lease_id, unit_id,
          for_month, due_date, bill_type,
          rent_amount, status,
          snap_payment_method, snap_paybill_number, snap_account_reference,
          generated_by, created_by
        ) VALUES (
          ${randomUUID()}, ${companyId}, ${id}, ${data.unitId},
          ${forMonth}, ${dueDate}, 'signing',
          ${data.depositAmount}, 'open',
          ${company.payment_method},
          ${company.paybill_number ?? null},
          ${accountReference},
          'system', ${userId}
        )
        ON CONFLICT DO NOTHING
      `;
    }
  });

  logger.info({ leaseId: id, companyId, unitId: data.unitId }, 'Lease created');
  res.status(201).json({ success: true, data: { lease: { id } } } satisfies ApiResponse<unknown>);
});

// ─── PATCH /leases/:id/terminate ─────────────────────────────────────────────

leasesRouter.patch('/:id/terminate', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { reason, actualMoveOutDate } = z.object({
    reason:            z.string().min(1),
    actualMoveOutDate: z.string().optional(),
  }).parse(req.body);

  await withRLSTransaction(ctx(req), async (tx) => {
    const [lease] = await tx`
      SELECT id, unit_id, status FROM leases WHERE id = ${id}
    `;
    if (!lease) throw new NotFoundError('Lease not found');
    if (!['active','notice'].includes(lease.status)) {
      throw new Error('Only active or notice leases can be terminated');
    }

    await tx`
      UPDATE leases SET
        status             = 'terminated',
        terminated_at      = NOW(),
        termination_reason = ${reason},
        actual_move_out_date = ${actualMoveOutDate ?? null},
        updated_at         = NOW()
      WHERE company_id = ${req.ctx.companyId} AND id = ${id}
    `;

    // Free the unit
    await tx`
      UPDATE units SET is_occupied = false, updated_at = NOW()
      WHERE id = ${lease.unit_id} AND company_id = ${req.ctx.companyId}
    `;
  });

  res.json({ success: true, data: { message: 'Lease terminated' } } satisfies ApiResponse<unknown>);
});

// ─── PATCH /leases/:id/notice ─────────────────────────────────────────────────

leasesRouter.patch('/:id/notice', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { vacateNoticeDate, statedMoveOutDate } = z.object({
    vacateNoticeDate:  z.string(),
    statedMoveOutDate: z.string(),
  }).parse(req.body);

  const [updated] = await withRLS(ctx(req), async (db) => {
    return db`
      UPDATE leases SET
        status               = 'notice',
        vacate_notice_date   = ${vacateNoticeDate},
        stated_move_out_date = ${statedMoveOutDate},
        updated_at           = NOW()
      WHERE id = ${id} AND company_id = ${req.ctx.companyId} AND status = 'active'
      RETURNING id
    `;
  });

  if (!updated) throw new NotFoundError('Lease not found or not active');
  res.json({ success: true, data: { message: 'Notice recorded' } } satisfies ApiResponse<unknown>);
});

// ─── PATCH /leases/:id/deposit ────────────────────────────────────────────────

leasesRouter.patch('/:id/deposit', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { amountPaid, paidAt } = z.object({
    amountPaid: z.number().positive(),
    paidAt:     z.string().optional(),
  }).parse(req.body);

  const paidDate = paidAt ?? new Date().toISOString().slice(0, 10);

  const updated = await withRLSTransaction(ctx(req), async (tx) => {
    // 1. Update lease deposit tracking
    const [lease] = await tx`
      UPDATE leases SET
        deposit_paid_amount = deposit_paid_amount + ${amountPaid},
        deposit_paid_at     = COALESCE(deposit_paid_at, ${paidDate}),
        updated_at          = NOW()
      WHERE id = ${id} AND company_id = ${req.ctx.companyId} AND status IN ('active','notice')
      RETURNING id, lease_id, unit_id, company_id, deposit_amount, deposit_paid_amount, deposit_paid_at, snap_account_reference
    `;
    if (!lease) return null;

    // 2. Find the deposit bill for this lease (if any)
    const [depositBill] = await tx`
      SELECT id, total_amount, total_paid
      FROM monthly_bills
      WHERE lease_id = ${id}
        AND company_id = ${req.ctx.companyId}
        AND bill_type = 'deposit'
        AND status NOT IN ('paid', 'waived', 'void')
      ORDER BY for_month ASC
      LIMIT 1
    `;

    if (depositBill) {
      // 3. Insert payment record linked to the deposit bill
      const receiptRef = `DEP-${Date.now()}`;
      await tx`
        INSERT INTO payments (
          id, company_id, bill_id, lease_id,
          amount, channel,
          bank_transaction_ref,
          recorded_at, recorded_by, notes
        ) VALUES (
          ${randomUUID()}, ${req.ctx.companyId}, ${depositBill.id}, ${id},
          ${amountPaid}, 'bank_transfer',
          ${receiptRef},
          ${paidDate}, ${req.ctx.userId}, 'Deposit payment'
        )
      `;

      // 4. Update deposit bill total_paid and status
      const newTotalPaid = parseFloat(depositBill.total_paid ?? '0') + amountPaid;
      const billTotal    = parseFloat(depositBill.total_amount);
      const newStatus    = newTotalPaid >= billTotal - 0.01 ? 'paid' : 'partial';

      await tx`
        UPDATE monthly_bills SET
          total_paid = ${newTotalPaid},
          status     = ${newStatus},
          updated_at = NOW()
        WHERE id = ${depositBill.id}
      `;
    }

    return lease;
  });

  if (!updated) throw new NotFoundError('Lease not found or not active');
  logger.info({ leaseId: id, amountPaid }, 'Deposit payment recorded');
  res.json({ success: true, data: { lease: updated } } satisfies ApiResponse<unknown>);
});