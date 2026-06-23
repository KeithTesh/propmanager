// api/src/modules/superadmin/superadmin.router.ts

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { sql } from '../../db';
import { requireRole } from '../../middleware/auth';
import { NotFoundError, ValidationError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { ApiResponse } from '../../types';

export const superAdminRouter = Router();
const requireSuperAdmin = requireRole('super_admin');

// ─── GET /superadmin/stats ────────────────────────────────────────────────────

superAdminRouter.get('/stats', requireSuperAdmin, async (_req: Request, res: Response) => {
  const [stats] = await sql`
    SELECT
      COUNT(*)                                                        AS total_companies,
      COUNT(*) FILTER (WHERE subscription_status = 'active')         AS active,
      COUNT(*) FILTER (WHERE subscription_status = 'trialing')       AS trialing,
      COUNT(*) FILTER (WHERE subscription_status = 'suspended')      AS suspended,
      COUNT(*) FILTER (WHERE subscription_status = 'cancelled')      AS cancelled,
      COUNT(*) FILTER (WHERE subscription_status = 'expired')        AS expired,
      COUNT(*) FILTER (WHERE trial_ends_at < NOW()
        AND subscription_status = 'trialing')                        AS trials_expired,
      COUNT(*) FILTER (WHERE trial_ends_at > NOW()
        AND trial_ends_at < NOW() + INTERVAL '7 days'
        AND subscription_status = 'trialing')                        AS trials_expiring_soon,
      COALESCE(SUM(monthly_fee) FILTER (WHERE subscription_status = 'active'), 0) AS mrr,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS new_this_month
    FROM companies
    WHERE deleted_at IS NULL
  `;

  const planBreakdown = await sql`
    SELECT plan, subscription_status, COUNT(*) AS count, SUM(monthly_fee) AS revenue
    FROM companies
    WHERE deleted_at IS NULL
    GROUP BY plan, subscription_status
    ORDER BY plan, subscription_status
  `;

  res.json({ success: true, data: { stats, planBreakdown } } satisfies ApiResponse<unknown>);
});

// ─── GET /superadmin/companies ────────────────────────────────────────────────

superAdminRouter.get('/companies', requireSuperAdmin, async (req: Request, res: Response) => {
  const { search, status, plan } = req.query as Record<string, string | undefined>;

  const companies = await sql`
    SELECT
      c.id, c.name, c.trading_name, c.email, c.phone, c.county,
      c.plan, c.subscription_status, c.monthly_fee, c.unit_limit, c.units_used,
      c.sms_quota_monthly, c.sms_used_this_month, c.account_type,
      c.trial_ends_at, c.subscription_ends_at, c.next_billing_at,
      c.suspended_at, c.suspension_reason, c.setup_completed,
      c.created_at, c.notes,
      -- owner info
      u.full_name  AS owner_name,
      u.email      AS owner_email,
      u.phone      AS owner_phone,
      u.last_login_at AS owner_last_login,
      -- usage stats
      (SELECT COUNT(*) FROM properties p WHERE p.company_id = c.id AND p.deleted_at IS NULL)    AS property_count,
      (SELECT COUNT(*) FROM units un
        JOIN properties p ON p.id = un.property_id
        WHERE p.company_id = c.id AND un.deleted_at IS NULL)                                     AS unit_count,
      (SELECT COUNT(*) FROM leases l WHERE l.company_id = c.id AND l.status = 'active')         AS active_leases,
      (SELECT COUNT(*) FROM tenants t WHERE t.company_id = c.id AND t.deleted_at IS NULL)        AS tenant_count
    FROM companies c
    LEFT JOIN users u ON u.company_id = c.id AND u.role = 'owner' AND u.deleted_at IS NULL
    WHERE c.deleted_at IS NULL
      ${search ? sql`AND (c.name ILIKE ${'%' + search + '%'} OR c.email ILIKE ${'%' + search + '%'} OR u.email ILIKE ${'%' + search + '%'})` : sql``}
      ${status ? sql`AND c.subscription_status = ${status}` : sql``}
      ${plan   ? sql`AND c.plan = ${plan}`                   : sql``}
    ORDER BY c.created_at DESC
  `;

  res.json({ success: true, data: { companies } } satisfies ApiResponse<unknown>);
});

// ─── GET /superadmin/companies/:id ───────────────────────────────────────────

superAdminRouter.get('/companies/:id', requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;

  const [company] = await sql`
    SELECT c.*,
      u.full_name AS owner_name, u.email AS owner_email, u.phone AS owner_phone
    FROM companies c
    LEFT JOIN users u ON u.company_id = c.id AND u.role = 'owner' AND u.deleted_at IS NULL
    WHERE c.id = ${id} AND c.deleted_at IS NULL
  `;
  if (!company) throw new NotFoundError('Company not found');

  const events = await sql`
    SELECT se.*, u.full_name AS performed_by_name
    FROM subscription_events se
    LEFT JOIN users u ON u.id = se.performed_by
    WHERE se.company_id = ${id}
    ORDER BY se.created_at DESC
    LIMIT 50
  `;

  res.json({ success: true, data: { company, events } } satisfies ApiResponse<unknown>);
});

// ─── POST /superadmin/companies ── create company ────────────────────────────

superAdminRouter.post('/companies', requireSuperAdmin, async (req: Request, res: Response) => {
  const body = z.object({
    name:       z.string().min(2),
    email:      z.string().email(),
    phone:      z.string().min(9),
    county:     z.string().optional(),
    plan:       z.enum(['trial','starter','growth','pro','enterprise']).default('trial'),
    monthlyFee: z.number().min(0).default(0),
    unitLimit:  z.number().int().min(1).default(50),
    notes:      z.string().optional(),
  }).parse(req.body);

  const [existing] = await sql`SELECT id FROM companies WHERE email = lower(${body.email}) AND deleted_at IS NULL`;
  if (existing) throw new ValidationError('A company with this email already exists');

  const trialEnds = new Date();
  trialEnds.setDate(trialEnds.getDate() + 30);

  const [company] = await sql`
    INSERT INTO companies (name, email, phone, county, plan, subscription_status,
      monthly_fee, unit_limit, trial_ends_at, billing_email, notes)
    VALUES (${body.name}, lower(${body.email}), ${body.phone}, ${body.county ?? null},
      ${body.plan}, 'trialing', ${body.monthlyFee}, ${body.unitLimit},
      ${trialEnds.toISOString()}, lower(${body.email}), ${body.notes ?? null})
    RETURNING id, name, email
  `;

  await sql`
    INSERT INTO subscription_events (company_id, event_type, new_status, new_plan, notes, performed_by)
    VALUES (${company.id}, 'trial_started', 'trialing', ${body.plan}, 'Company created by super admin', ${req.ctx.userId})
  `;

  logger.info({ companyId: company.id }, 'Company created by super admin');
  res.status(201).json({ success: true, data: { company } } satisfies ApiResponse<unknown>);
});

// ─── PATCH /superadmin/companies/:id/plan ────────────────────────────────────

superAdminRouter.patch('/companies/:id/plan', requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const body = z.object({
    plan:       z.enum(['trial','starter','growth','pro','enterprise','starter_agent','growth_agent','enterprise_agent']),
    monthlyFee: z.number().min(0),
    unitLimit:  z.number().int().min(1),
    smsQuota:   z.number().int().min(0).optional(),
    notes:      z.string().optional(),
  }).parse(req.body);

  const [company] = await sql`SELECT id, plan, subscription_status FROM companies WHERE id = ${id} AND deleted_at IS NULL`;
  if (!company) throw new NotFoundError('Company not found');

  await sql`
    UPDATE companies SET
      plan               = ${body.plan},
      monthly_fee        = ${body.monthlyFee},
      unit_limit         = ${body.unitLimit},
      sms_quota_monthly  = COALESCE(${body.smsQuota ?? null}, sms_quota_monthly),
      updated_at         = NOW()
    WHERE id = ${id}
  `;

  await sql`
    INSERT INTO subscription_events (company_id, event_type, old_plan, new_plan, amount, notes, performed_by)
    VALUES (${id}, 'plan_changed', ${company.plan}, ${body.plan}, ${body.monthlyFee}, ${body.notes ?? null}, ${req.ctx.userId})
  `;

  res.json({ success: true, data: { message: 'Plan updated' } } satisfies ApiResponse<unknown>);
});

// ─── POST /superadmin/companies/:id/activate ─────────────────────────────────

superAdminRouter.post('/companies/:id/activate', requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { notes, billingDays } = z.object({
    notes:       z.string().optional(),
    billingDays: z.number().int().min(1).default(30),
  }).parse(req.body);

  const [company] = await sql`SELECT id, subscription_status, plan FROM companies WHERE id = ${id} AND deleted_at IS NULL`;
  if (!company) throw new NotFoundError('Company not found');

  const nextBilling = new Date();
  nextBilling.setDate(nextBilling.getDate() + billingDays);
  const subEnds = new Date();
  subEnds.setDate(subEnds.getDate() + billingDays);

  await sql`
    UPDATE companies SET
      subscription_status  = 'active',
      suspended_at         = NULL,
      suspension_reason    = NULL,
      subscription_ends_at = ${subEnds.toISOString()},
      next_billing_at      = ${nextBilling.toISOString()},
      last_billed_at       = NOW(),
      updated_at           = NOW()
    WHERE id = ${id}
  `;

  await sql`
    INSERT INTO subscription_events (company_id, event_type, old_status, new_status, notes, performed_by)
    VALUES (${id}, 'activated', ${company.subscription_status}, 'active', ${notes ?? null}, ${req.ctx.userId})
  `;

  logger.info({ companyId: id }, 'Company subscription activated');
  res.json({ success: true, data: { message: 'Subscription activated' } } satisfies ApiResponse<unknown>);
});

// ─── POST /superadmin/companies/:id/suspend ──────────────────────────────────

superAdminRouter.post('/companies/:id/suspend', requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { reason } = z.object({ reason: z.string().min(5) }).parse(req.body);

  const [company] = await sql`SELECT id, subscription_status FROM companies WHERE id = ${id} AND deleted_at IS NULL`;
  if (!company) throw new NotFoundError('Company not found');
  if (company.subscription_status === 'suspended') throw new ValidationError('Already suspended');

  await sql`
    UPDATE companies SET
      subscription_status = 'suspended',
      suspended_at        = NOW(),
      suspension_reason   = ${reason},
      updated_at          = NOW()
    WHERE id = ${id}
  `;

  await sql`
    INSERT INTO subscription_events (company_id, event_type, old_status, new_status, notes, performed_by)
    VALUES (${id}, 'suspended', ${company.subscription_status}, 'suspended', ${reason}, ${req.ctx.userId})
  `;

  logger.info({ companyId: id, reason }, 'Company suspended');
  res.json({ success: true, data: { message: 'Company suspended' } } satisfies ApiResponse<unknown>);
});

// ─── POST /superadmin/companies/:id/cancel ───────────────────────────────────

superAdminRouter.post('/companies/:id/cancel', requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { reason } = z.object({ reason: z.string().min(5) }).parse(req.body);

  const [company] = await sql`SELECT id, subscription_status FROM companies WHERE id = ${id} AND deleted_at IS NULL`;
  if (!company) throw new NotFoundError('Company not found');

  await sql`
    UPDATE companies SET
      subscription_status = 'cancelled',
      suspended_at        = NOW(),
      suspension_reason   = ${reason},
      updated_at          = NOW()
    WHERE id = ${id}
  `;

  await sql`
    INSERT INTO subscription_events (company_id, event_type, old_status, new_status, notes, performed_by)
    VALUES (${id}, 'cancelled', ${company.subscription_status}, 'cancelled', ${reason}, ${req.ctx.userId})
  `;

  res.json({ success: true, data: { message: 'Subscription cancelled' } } satisfies ApiResponse<unknown>);
});

// ─── DELETE /superadmin/companies/:id ────────────────────────────────────────

superAdminRouter.delete('/companies/:id', requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  z.object({ confirm: z.literal('DELETE') }).parse(req.body);

  const [company] = await sql`SELECT id, name FROM companies WHERE id = ${id} AND deleted_at IS NULL`;
  if (!company) throw new NotFoundError('Company not found');

  // Soft-delete company
  await sql`UPDATE companies SET deleted_at = NOW(), updated_at = NOW() WHERE id = ${id}`;

  // Deactivate ALL users belonging to this company so their tokens are rejected immediately
  await sql`UPDATE users SET is_active = false, updated_at = NOW() WHERE company_id = ${id}`;

  logger.warn({ companyId: id, companyName: company.name }, 'Company deleted by super admin');
  res.json({ success: true, data: { message: `${company.name} has been deleted` } } satisfies ApiResponse<unknown>);
});


// ─── POST /superadmin/companies/:id/restore ───────────────────────────────────
// Restores a soft-deleted company (within 30-day grace window)

superAdminRouter.post('/companies/:id/restore', requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;

  // Find soft-deleted company within 30 days
  const [company] = await sql`
    SELECT id, name, deleted_at
    FROM companies
    WHERE id = ${id}
      AND deleted_at IS NOT NULL
      AND deleted_at > NOW() - INTERVAL '30 days'
  `;

  if (!company) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Company not found or deletion window has expired (30 days).' },
    });
    return;
  }

  // Restore company
  await sql`
    UPDATE companies SET
      deleted_at = NULL,
      updated_at = NOW()
    WHERE id = ${id}
  `;

  // Re-activate all users
  await sql`
    UPDATE users SET is_active = true, updated_at = NOW()
    WHERE company_id = ${id}
  `;

  // Log event
  await sql`
    INSERT INTO subscription_events (company_id, event_type, notes, performed_by)
    VALUES (${id}, 'activated', 'Company restored from soft-delete by super admin', ${req.ctx.userId})
  `;

  logger.info({ companyId: id, companyName: company.name }, 'Company restored by super admin');
  res.json({ success: true, data: { message: `${company.name} has been restored successfully.` } } satisfies ApiResponse<unknown>);
});

// ─── GET /superadmin/deleted ── list soft-deleted companies ───────────────────

superAdminRouter.get('/deleted', requireSuperAdmin, async (_req: Request, res: Response) => {
  const companies = await sql`
    SELECT
      c.id, c.name, c.email, c.phone, c.deleted_at,
      c.plan, c.subscription_status,
      u.full_name AS owner_name,
      -- Days remaining in 30-day restore window
      GREATEST(0, 30 - EXTRACT(DAY FROM NOW() - c.deleted_at)::int) AS days_to_purge
    FROM companies c
    LEFT JOIN users u ON u.company_id = c.id AND u.role = 'owner'
    WHERE c.deleted_at IS NOT NULL
      AND c.deleted_at > NOW() - INTERVAL '30 days'
    ORDER BY c.deleted_at DESC
  `;
  res.json({ success: true, data: { companies } } satisfies ApiResponse<unknown>);
});

// ─── GET /superadmin/events ───────────────────────────────────────────────────

superAdminRouter.get('/events', requireSuperAdmin, async (_req: Request, res: Response) => {
  const events = await sql`
    SELECT se.*, c.name AS company_name, u.full_name AS performed_by_name
    FROM subscription_events se
    JOIN companies c ON c.id = se.company_id
    LEFT JOIN users u ON u.id = se.performed_by
    ORDER BY se.created_at DESC
    LIMIT 100
  `;
  res.json({ success: true, data: { events } } satisfies ApiResponse<unknown>);
});

// ─── GET /superadmin/pending ─── all pending requests across platform ─────────

superAdminRouter.get('/pending', requireSuperAdmin, async (_req: Request, res: Response) => {
  const senderRequests = await sql`
    SELECT sr.*, c.name AS company_name, u.full_name AS requested_by_name
    FROM sender_id_requests sr
    JOIN companies c ON c.id = sr.company_id
    JOIN users u     ON u.id = sr.requested_by
    WHERE sr.status = 'pending'
    ORDER BY sr.created_at ASC
  `;

  const quotaRequests = await sql`
    SELECT qr.*, c.name AS company_name, u.full_name AS requested_by_name
    FROM sms_quota_requests qr
    JOIN companies c ON c.id = qr.company_id
    JOIN users u     ON u.id = qr.requested_by
    WHERE qr.status = 'pending'
    ORDER BY qr.created_at ASC
  `;

  res.json({ success: true, data: { senderRequests, quotaRequests } } satisfies ApiResponse<unknown>);
});

// ─── POST /superadmin/sender-id/:id/approve ──────────────────────────────────

superAdminRouter.post('/sender-id/:id/approve', requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;

  const [request] = await sql`
    SELECT * FROM sender_id_requests WHERE id = ${id} AND status = 'pending'
  `;
  if (!request) throw new NotFoundError('Request not found or already reviewed');

  // Apply to company
  await sql`
    UPDATE companies SET
      at_sender_id = ${request.sender_id},
      at_username  = ${request.at_username},
      at_api_key   = ${request.at_api_key},
      updated_at   = NOW()
    WHERE id = ${request.company_id}
  `;

  await sql`
    UPDATE sender_id_requests SET
      status      = 'approved',
      reviewed_by = ${req.ctx.userId},
      reviewed_at = NOW()
    WHERE id = ${id}
  `;

  logger.info({ requestId: id, companyId: request.company_id }, 'Sender ID approved');
  res.json({ success: true, data: { message: 'Sender ID approved and applied' } } satisfies ApiResponse<unknown>);
});

// ─── POST /superadmin/sender-id/:id/reject ───────────────────────────────────

superAdminRouter.post('/sender-id/:id/reject', requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { note } = z.object({ note: z.string().min(5) }).parse(req.body);

  const [request] = await sql`SELECT id FROM sender_id_requests WHERE id = ${id} AND status = 'pending'`;
  if (!request) throw new NotFoundError('Request not found or already reviewed');

  await sql`
    UPDATE sender_id_requests SET
      status         = 'rejected',
      reviewed_by    = ${req.ctx.userId},
      reviewed_at    = NOW(),
      rejection_note = ${note}
    WHERE id = ${id}
  `;

  res.json({ success: true, data: { message: 'Sender ID request rejected' } } satisfies ApiResponse<unknown>);
});

// ─── POST /superadmin/quota/:id/approve ──────────────────────────────────────

superAdminRouter.post('/quota/:id/approve', requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;

  const [request] = await sql`
    SELECT * FROM sms_quota_requests WHERE id = ${id} AND status = 'pending'
  `;
  if (!request) throw new NotFoundError('Request not found or already reviewed');

  await sql`
    UPDATE companies SET
      sms_quota_monthly = ${request.requested_quota},
      updated_at        = NOW()
    WHERE id = ${request.company_id}
  `;

  await sql`
    UPDATE sms_quota_requests SET
      status      = 'approved',
      reviewed_by = ${req.ctx.userId},
      reviewed_at = NOW()
    WHERE id = ${id}
  `;

  res.json({ success: true, data: { message: `Quota increased to ${request.requested_quota} SMS/month` } } satisfies ApiResponse<unknown>);
});

// ─── POST /superadmin/quota/:id/reject ───────────────────────────────────────

superAdminRouter.post('/quota/:id/reject', requireSuperAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { note } = z.object({ note: z.string().min(3) }).parse(req.body);

  await sql`
    UPDATE sms_quota_requests SET
      status         = 'rejected',
      rejection_note = ${note},
      reviewed_by    = ${req.ctx.userId},
      reviewed_at    = NOW()
    WHERE id = ${id} AND status = 'pending'
  `;

  res.json({ success: true, data: { message: 'Quota request rejected' } } satisfies ApiResponse<unknown>);
});


// ─── GET /superadmin/sms-usage ─── per-company SMS usage ─────────────────────

superAdminRouter.get('/sms-usage', requireSuperAdmin, async (_req: Request, res: Response) => {
  const companies = await sql`
    SELECT
      c.id, c.name,
      c.sms_quota_monthly    AS quota,
      c.sms_used_this_month  AS used,
      c.at_sender_id,
      c.sms_quota_reset_date AS reset_date,
      ROUND((c.sms_used_this_month::numeric / NULLIF(c.sms_quota_monthly, 0)) * 100, 1) AS usage_pct,
      -- Total SMS sent all time from usage log
      COALESCE((
        SELECT COUNT(*) FROM sms_usage_log sl WHERE sl.company_id = c.id
      ), 0) AS total_all_time,
      -- SMS sent this month from usage log
      COALESCE((
        SELECT COUNT(*) FROM sms_usage_log sl
        WHERE sl.company_id = c.id
          AND DATE_TRUNC('month', sl.created_at) = DATE_TRUNC('month', NOW())
      ), 0) AS sent_this_month
    FROM companies c
    WHERE c.deleted_at IS NULL
      AND c.sms_quota_monthly > 0
    ORDER BY c.sms_used_this_month DESC
  `;

  const totals = await sql`
    SELECT
      SUM(sms_used_this_month) AS total_used_this_month,
      SUM(sms_quota_monthly)   AS total_quota,
      COUNT(*) FILTER (WHERE at_sender_id IS NOT NULL)       AS companies_with_sender_id,
      COUNT(*) FILTER (WHERE account_type = 'agent')         AS agent_count,
      COUNT(*) FILTER (WHERE account_type = 'landlord' OR account_type IS NULL) AS landlord_count
    FROM companies WHERE deleted_at IS NULL
  `;

  res.json({ success: true, data: { companies, totals: totals[0] } } satisfies ApiResponse<unknown>);
});

// ─── GET /superadmin/platform-settings ── all configurable settings ──────────

superAdminRouter.get('/platform-settings', requireSuperAdmin, async (_req: Request, res: Response) => {
  const settings = await sql`SELECT key, value, description, updated_at FROM platform_settings ORDER BY key`;
  res.json({ success: true, data: { settings } } satisfies ApiResponse<unknown>);
});

// ─── PATCH /superadmin/platform-settings ── update one or many settings ──────

superAdminRouter.patch('/platform-settings', requireSuperAdmin, async (req: Request, res: Response) => {
  const updates = z.record(z.string()).parse(req.body);

  for (const [key, value] of Object.entries(updates)) {
    await sql`
      UPDATE platform_settings SET
        value      = ${value},
        updated_by = ${req.ctx.userId},
        updated_at = NOW()
      WHERE key = ${key}
    `;
  }

  // If trial_days changed, log it
  if (updates.trial_days) {
    logger.info({ trial_days: updates.trial_days, by: req.ctx.userId }, 'Trial days updated by super admin');
  }

  res.json({ success: true, data: { message: 'Settings updated', updated: Object.keys(updates) } } satisfies ApiResponse<unknown>);
});