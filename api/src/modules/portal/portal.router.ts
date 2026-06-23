// api/src/modules/portal/portal.router.ts
//
// Tenant-facing portal endpoints. All routes require role = 'tenant'.
// The tenant user sees only their own lease, bills, payments, maintenance.
//
// Setup flow:
//   Manager calls POST /tenants/:id/invite  → creates users row (role=tenant),
//   links tenants.user_id, returns a one-time password.
//   Tenant logs in via the normal POST /auth/login endpoint.

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { withRLS } from '../../db';
import type { RLSContext } from '../../db';
import { authenticate } from '../../middleware/auth';
import { ForbiddenError, NotFoundError } from '../../lib/errors';

export const portalRouter = Router();

// ─── Guard: tenant role only ──────────────────────────────────────────────────

function tenantOnly(req: Request) {
  if (req.ctx.userRole !== 'tenant') {
    throw new ForbiddenError('This endpoint is only accessible to tenants');
  }
}

portalRouter.use(authenticate);

function ctx(req: Request): RLSContext {
  return { companyId: req.ctx.companyId!, userId: req.ctx.userId, userRole: req.ctx.userRole };
}

// ─── GET /portal/me ────────────────────────────────────────────────────────────
// Tenant's own profile + their active lease + unit + property

portalRouter.get('/me', async (req: Request, res: Response) => {
  tenantOnly(req);
  const c = ctx(req);

  const [tenant] = await withRLS(c, async (db) => db`
    SELECT
      t.id, t.full_name, t.email, t.phone,
      t.national_id, t.is_corporate, t.company_name,
      t.notify_sms, t.notify_email,
      -- Active lease
      l.id              AS lease_id,
      l.status          AS lease_status,
      l.start_date,
      l.end_date,
      l.monthly_rent,
      l.deposit_amount,
      l.deposit_paid_at,
      l.deposit_paid_amount,
      l.notice_period_days,
      l.vacate_notice_date,
      -- Unit
      u.id              AS unit_id,
      u.unit_number,
      u.unit_type,
      u.floor_number,
      u.bedrooms,
      u.bathrooms,
      -- Property
      p.id              AS property_id,
      p.name            AS property_name,
      p.address         AS property_address,
      p.county          AS property_county,
      -- Payment details (from lease snapshot)
      l.snap_payment_method,
      l.snap_paybill_number,
      l.snap_account_reference,
      -- Company
      co.name           AS company_name_display,
      co.phone          AS company_phone,
      co.email          AS company_email
    FROM tenants t
    JOIN leases l      ON l.primary_tenant_id = t.id AND l.status IN ('active','notice')
    JOIN units u       ON u.id = l.unit_id
    JOIN properties p  ON p.id = u.property_id
    JOIN companies co  ON co.id = t.company_id
    WHERE t.user_id = ${req.ctx.userId}
      AND t.company_id = ${c.companyId}
      AND t.deleted_at IS NULL
    LIMIT 1
  `);

  if (!tenant) {
    // Return profile without lease if no active lease
    const [t] = await withRLS(c, async (db) => db`
      SELECT id, full_name, email, phone,
             national_id, is_corporate, company_name,
             notify_sms, notify_email
      FROM tenants
      WHERE user_id = ${req.ctx.userId}
        AND company_id = ${c.companyId}
        AND deleted_at IS NULL
      LIMIT 1
    `);
    if (!t) throw new NotFoundError('Tenant profile not found');
    res.json({ success: true, data: { tenant: t, lease: null } });
    return;
  }

  res.json({ success: true, data: { tenant } });
});

// ─── GET /portal/bills ─────────────────────────────────────────────────────────
// All bills for the tenant's active lease, newest first

portalRouter.get('/bills', async (req: Request, res: Response) => {
  tenantOnly(req);
  const c = ctx(req);

  const { status, page = '1', per_page = '20' } = req.query as Record<string, string | undefined>;
  const offset = (Number(page) - 1) * Number(per_page);

  const bills = await withRLS(c, async (db) => db`
    SELECT
      mb.id,
      mb.for_month,
      mb.due_date,
      mb.bill_type,
      mb.rent_amount,
      mb.penalty_amount,
      mb.total_amount,
      mb.total_paid,
      mb.total_due,
      mb.status,
      mb.snap_payment_method,
      mb.snap_paybill_number,
      mb.snap_account_reference,
      mb.published_at,
      -- Pending items (expense charges, adjustments)
      COALESCE((
        SELECT json_agg(json_build_object(
          'description', pbi.description,
          'amount',      pbi.amount
        ) ORDER BY pbi.created_at)
        FROM pending_bill_items pbi
        WHERE pbi.bill_id = mb.id AND pbi.apply_status = 'applied'
      ), '[]'::json) AS line_items,
      -- Last payment
      (SELECT MAX(py.recorded_at) FROM payments py
       WHERE py.bill_id = mb.id AND py.undone_at IS NULL) AS last_payment_at
    FROM monthly_bills mb
    JOIN leases l ON l.id = mb.lease_id
    WHERE l.primary_tenant_id = (
        SELECT id FROM tenants WHERE user_id = ${req.ctx.userId}
          AND company_id = ${c.companyId} AND deleted_at IS NULL LIMIT 1
      )
      AND mb.company_id = ${c.companyId}
      AND mb.status NOT IN ('draft','void')
      ${status ? db`AND mb.status = ${status}` : db``}
    ORDER BY mb.for_month DESC
    LIMIT ${Number(per_page)} OFFSET ${offset}
  `);

  const [{ count }] = await withRLS(c, async (db) => db`
    SELECT COUNT(*) FROM monthly_bills mb
    JOIN leases l ON l.id = mb.lease_id
    WHERE l.primary_tenant_id = (
        SELECT id FROM tenants WHERE user_id = ${req.ctx.userId}
          AND company_id = ${c.companyId} AND deleted_at IS NULL LIMIT 1
      )
      AND mb.company_id = ${c.companyId}
      AND mb.status NOT IN ('draft','void')
      ${status ? db`AND mb.status = ${status}` : db``}
  `);

  res.json({
    success: true,
    data: { bills },
    meta: {
      total: Number(count),
      page: Number(page),
      perPage: Number(per_page),
      totalPages: Math.ceil(Number(count) / Number(per_page)),
    },
  });
});

// ─── GET /portal/bills/:id ─────────────────────────────────────────────────────

portalRouter.get('/bills/:id', async (req: Request, res: Response) => {
  tenantOnly(req);
  const c = ctx(req);

  const [bill] = await withRLS(c, async (db) => db`
    SELECT
      mb.*,
      COALESCE((
        SELECT json_agg(json_build_object(
          'description', pbi.description,
          'amount',      pbi.amount
        ) ORDER BY pbi.created_at)
        FROM pending_bill_items pbi
        WHERE pbi.bill_id = mb.id AND pbi.apply_status = 'applied'
      ), '[]'::json) AS line_items,
      COALESCE((
        SELECT json_agg(json_build_object(
          'id',            py.id,
          'amount',        py.amount,
          'channel',       py.channel,
          'receipt_number',py.receipt_number,
          'recorded_at',   py.recorded_at,
          'mpesa_receipt', py.mpesa_receipt_number
        ) ORDER BY py.recorded_at DESC)
        FROM payments py
        WHERE py.bill_id = mb.id AND py.undone_at IS NULL
      ), '[]'::json) AS payments
    FROM monthly_bills mb
    JOIN leases l ON l.id = mb.lease_id
    WHERE mb.id = ${req.params.id}
      AND mb.company_id = ${c.companyId}
      AND l.primary_tenant_id = (
        SELECT id FROM tenants WHERE user_id = ${req.ctx.userId}
          AND company_id = ${c.companyId} AND deleted_at IS NULL LIMIT 1
      )
      AND mb.status NOT IN ('draft','void')
    LIMIT 1
  `);

  if (!bill) throw new NotFoundError('Bill not found');
  res.json({ success: true, data: { bill } });
});

// ─── GET /portal/payments ──────────────────────────────────────────────────────
// Full payment history for this tenant

portalRouter.get('/payments', async (req: Request, res: Response) => {
  tenantOnly(req);
  const c = ctx(req);

  const { page = '1', per_page = '20' } = req.query;
  const offset = (Number(page) - 1) * Number(per_page);

  const payments = await withRLS(c, async (db) => db`
    SELECT
      py.id,
      py.amount,
      py.channel,
      py.receipt_number,
      py.mpesa_receipt_number,
      py.recorded_at,
      py.notes,
      mb.for_month,
      mb.bill_type,
      mb.due_date
    FROM payments py
    JOIN monthly_bills mb ON mb.id = py.bill_id
    JOIN leases l         ON l.id  = mb.lease_id
    WHERE py.company_id = ${c.companyId}
      AND py.undone_at IS NULL
      AND l.primary_tenant_id = (
        SELECT id FROM tenants WHERE user_id = ${req.ctx.userId}
          AND company_id = ${c.companyId} AND deleted_at IS NULL LIMIT 1
      )
    ORDER BY py.recorded_at DESC
    LIMIT ${Number(per_page)} OFFSET ${offset}
  `);

  const [{ count }] = await withRLS(c, async (db) => db`
    SELECT COUNT(*) FROM payments py
    JOIN monthly_bills mb ON mb.id = py.bill_id
    JOIN leases l         ON l.id  = mb.lease_id
    WHERE py.company_id = ${c.companyId}
      AND py.undone_at IS NULL
      AND l.primary_tenant_id = (
        SELECT id FROM tenants WHERE user_id = ${req.ctx.userId}
          AND company_id = ${c.companyId} AND deleted_at IS NULL LIMIT 1
      )
  `);

  res.json({
    success: true,
    data: { payments },
    meta: {
      total: Number(count),
      page: Number(page),
      perPage: Number(per_page),
      totalPages: Math.ceil(Number(count) / Number(per_page)),
    },
  });
});

// ─── GET /portal/maintenance ───────────────────────────────────────────────────

portalRouter.get('/maintenance', async (req: Request, res: Response) => {
  tenantOnly(req);
  const c = ctx(req);

  const requests = await withRLS(c, async (db) => db`
    SELECT
      mr.id, mr.title, mr.description, mr.category, mr.priority,
      mr.status, mr.reported_at, mr.resolved_at, mr.resolution_notes AS notes,
      u.unit_number, p.name AS property_name
    FROM maintenance_requests mr
    JOIN units u      ON u.id = mr.unit_id
    JOIN properties p ON p.id = mr.property_id
    WHERE mr.company_id = ${c.companyId}
      AND mr.reported_by = ${req.ctx.userId}
    ORDER BY mr.reported_at DESC
  `);

  res.json({ success: true, data: { requests } });
});

// ─── POST /portal/maintenance ──────────────────────────────────────────────────

portalRouter.post('/maintenance', async (req: Request, res: Response) => {
  tenantOnly(req);
  const c = ctx(req);

  const body = z.object({
    title:       z.string().min(3).max(200),
    description: z.string().min(10).max(2000),
    category:    z.string().optional(),
    priority:    z.enum(['low','medium','high']).default('medium'),
  }).parse(req.body);

  // Get tenant + their active lease unit
  const [tenantLease] = await withRLS(c, async (db) => db`
    SELECT t.id AS tenant_id, l.unit_id, u.property_id
    FROM tenants t
    JOIN leases l ON l.primary_tenant_id = t.id AND l.status IN ('active','notice')
    JOIN units u  ON u.id = l.unit_id
    WHERE t.user_id    = ${req.ctx.userId}
      AND t.company_id = ${c.companyId}
      AND t.deleted_at IS NULL
    LIMIT 1
  `);

  if (!tenantLease) throw new NotFoundError('No active lease found');

  const [request] = await withRLS(c, async (db) => db`
    INSERT INTO maintenance_requests (
      company_id, property_id, unit_id,
      reported_by,
      title, description, category, priority,
      status, reported_at
    ) VALUES (
      ${c.companyId},
      ${tenantLease.property_id},
      ${tenantLease.unit_id},
      ${req.ctx.userId},
      ${body.title}, ${body.description},
      ${body.category ?? null},
      ${body.priority},
      'open',
      NOW()
    )
    RETURNING *
  `);

  res.status(201).json({ success: true, data: { request } });
});

// ─── PATCH /portal/profile ─────────────────────────────────────────────────────
// Tenant can update their own contact preferences

portalRouter.patch('/profile', async (req: Request, res: Response) => {
  tenantOnly(req);
  const c = ctx(req);

  const body = z.object({
    notifySms:    z.boolean().optional(),
    notifyEmail:  z.boolean().optional(),
  }).parse(req.body);

  const [updated] = await withRLS(c, async (db) => db`
    UPDATE tenants SET
      notify_sms   = COALESCE(${body.notifySms  ?? null},  notify_sms),
      notify_email = COALESCE(${body.notifyEmail ?? null}, notify_email),
      updated_at   = NOW()
    WHERE user_id    = ${req.ctx.userId}
      AND company_id = ${c.companyId}
      AND deleted_at IS NULL
    RETURNING id, full_name, email, phone, notify_sms, notify_email
  `);

  res.json({ success: true, data: { tenant: updated } });
});