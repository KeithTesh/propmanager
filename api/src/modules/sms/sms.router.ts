// api/src/modules/sms/sms.router.ts

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { sql, withRLS, RLSContext } from '../../db';
import { authenticate, requireRole } from '../../middleware/auth';
import { sendSms, fillTemplate } from '../../lib/sms';
import { logger } from '../../lib/logger';
import type { ApiResponse } from '../../types';

export const smsRouter = Router();
smsRouter.use(authenticate);

function ctx(req: Request): RLSContext {
  return { companyId: req.ctx.companyId!, userId: req.ctx.userId, userRole: req.ctx.userRole };
}

const PLACEHOLDERS = ['{tenant_name}','{amount}','{unit}','{month}','{due_date}','{receipt}','{paybill}','{account_ref}','{property}'];

function countSmsParts(msg: string) {
  return Math.ceil(msg.length / 160);
}

// ─── USAGE ────────────────────────────────────────────────────────────────────

// GET /sms/usage — company usage summary
smsRouter.get('/usage', requireRole('owner', 'finance'), async (req: Request, res: Response) => {
  const c   = ctx(req);
  const cid = c.companyId;

  const [company] = await withRLS(c, async (db) => db`
    SELECT sms_quota_monthly, sms_used_this_month, sms_quota_reset_date,
           at_sender_id, at_username
    FROM companies WHERE id = ${cid}
  `);

  const [monthStats] = await withRLS(c, async (db) => db`
    SELECT
      COUNT(*)                                          AS total_sent,
      COUNT(*) FILTER (WHERE status = 'sent')           AS successful,
      COUNT(*) FILTER (WHERE status = 'failed')         AS failed,
      COALESCE(SUM(sms_parts), 0)                       AS total_parts,
      COALESCE(SUM(at_cost), 0)                         AS total_cost
    FROM sms_usage_log
    WHERE company_id = ${cid}
      AND created_at >= DATE_TRUNC('month', NOW())
  `);

  const history = await withRLS(c, async (db) => db`
    SELECT
      TO_CHAR(DATE_TRUNC('month', created_at), 'Mon YYYY') AS month,
      COUNT(*) FILTER (WHERE status = 'sent')  AS sent,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed,
      COALESCE(SUM(sms_parts), 0)              AS parts
    FROM sms_usage_log
    WHERE company_id = ${cid}
      AND created_at >= NOW() - INTERVAL '6 months'
    GROUP BY DATE_TRUNC('month', created_at)
    ORDER BY DATE_TRUNC('month', created_at) DESC
  `);

  res.json({ success: true, data: { company, monthStats, history } } satisfies ApiResponse<unknown>);
});

// POST /sms/quota-request — request a quota increase
smsRouter.post('/quota-request', requireRole('owner'), async (req: Request, res: Response) => {
  const c   = ctx(req);
  const cid = c.companyId;
  const { requested_quota, reason } = z.object({
    requested_quota: z.number().min(100).max(50000),
    reason:          z.string().min(10).max(500),
  }).parse(req.body);

  const [company] = await withRLS(c, async (db) => db`
    SELECT sms_quota_monthly FROM companies WHERE id = ${cid}
  `);

  const [request] = await withRLS(c, async (db) => db`
    INSERT INTO sms_quota_requests (company_id, requested_by, current_quota, requested_quota, reason)
    VALUES (${cid}, ${c.userId}, ${company.sms_quota_monthly}, ${requested_quota}, ${reason})
    RETURNING *
  `);

  res.status(201).json({ success: true, data: { request } } satisfies ApiResponse<unknown>);
});

// ─── TEMPLATES ────────────────────────────────────────────────────────────────

// GET /sms/templates
smsRouter.get('/templates', async (req: Request, res: Response) => {
  const c   = ctx(req);
  const cid = c.companyId;

  const templates = await withRLS(c, async (db) => db`
    SELECT * FROM sms_templates
    WHERE company_id = ${cid}
    ORDER BY type
  `);

  // Auto-seed defaults if company has no templates yet
  if (templates.length === 0) {
    await withRLS(c, async (db) => db`
      INSERT INTO sms_templates (company_id, type, name, template)
      VALUES
        (${cid}, 'rent_reminder',        'Rent Reminder',        'Dear {tenant_name}, your rent of KES {amount} for {month} is due on {due_date}. Pay via M-Pesa PayBill {paybill}, Account: {account_ref}.'),
        (${cid}, 'payment_confirmation', 'Payment Confirmation', 'Dear {tenant_name}, payment of KES {amount} for {month} received. Receipt: {receipt}. Thank you.'),
        (${cid}, 'overdue',              'Overdue Notice',       'Dear {tenant_name}, your rent of KES {amount} for {month} is overdue. Please pay immediately to avoid penalties.'),
        (${cid}, 'penalty',              'Penalty Notice',       'Dear {tenant_name}, a late payment penalty of KES {amount} has been added to your account for {month}.'),
        (${cid}, 'custom_blast',         'Announcement',         'Dear {tenant_name}, ')
      ON CONFLICT (company_id, type) DO NOTHING
    `);
    const seeded = await withRLS(c, async (db) => db`
      SELECT * FROM sms_templates WHERE company_id = ${cid} ORDER BY type
    `);
    return res.json({ success: true, data: { templates: seeded, placeholders: PLACEHOLDERS } } satisfies ApiResponse<unknown>);
  }

  return res.json({ success: true, data: { templates, placeholders: PLACEHOLDERS } } satisfies ApiResponse<unknown>);
});

// PATCH /sms/templates/:type — update a template
smsRouter.patch('/templates/:type', requireRole('owner', 'manager'), async (req: Request, res: Response) => {
  const c    = ctx(req);
  const cid  = c.companyId;
  const type = req.params.type;
  const { template, name, is_active } = z.object({
    template:  z.string().min(10).max(320).optional(),
    name:      z.string().min(1).max(100).optional(),
    is_active: z.boolean().optional(),
  }).parse(req.body);

  const [updated] = await withRLS(c, async (db) => db`
    UPDATE sms_templates SET
      template   = COALESCE(${template ?? null}, template),
      name       = COALESCE(${name ?? null}, name),
      is_active  = COALESCE(${is_active ?? null}, is_active),
      updated_at = NOW()
    WHERE company_id = ${cid} AND type = ${type}
    RETURNING *
  `);

  if (!updated) return res.status(404).json({ success: false, error: 'Template not found' });
  return res.json({ success: true, data: { template: updated } } satisfies ApiResponse<unknown>);
});


// POST /sms/sender-id-request — request a custom AT sender ID approval
smsRouter.post('/sender-id-request', async (req: Request, res: Response) => {
  const { senderId, atUsername, atApiKey, reason } = z.object({
    senderId:  z.string().min(3).max(11),
    atUsername: z.string().min(3),
    atApiKey:  z.string().min(10),
    reason:    z.string().optional(),
  }).parse(req.body);

  const companyId = req.ctx.companyId!;

  // Check no pending request already exists
  const [existing] = await sql`
    SELECT id FROM sender_id_requests
    WHERE company_id = ${companyId} AND status = 'pending'
  `;
  if (existing) {
    res.status(409).json({ success: false, error: { code: 'PENDING_EXISTS', message: 'You already have a pending sender ID request. Please wait for it to be reviewed.' } });
    return;
  }

  await sql`
    INSERT INTO sender_id_requests (company_id, requested_by, sender_id, at_username, at_api_key, reason)
    VALUES (${companyId}, ${req.ctx.userId}, ${senderId}, ${atUsername}, ${atApiKey}, ${reason ?? null})
  `;

  res.status(201).json({ success: true, data: { message: 'Sender ID request submitted for review' } });
});

// GET /sms/sender-id-request — check status of sender ID request
smsRouter.get('/sender-id-request', async (req: Request, res: Response) => {
  const companyId = req.ctx.companyId!;
  const [request] = await sql`
    SELECT id, sender_id, status, rejection_note, created_at, reviewed_at
    FROM sender_id_requests
    WHERE company_id = ${companyId}
    ORDER BY created_at DESC LIMIT 1
  `;
  res.json({ success: true, data: { request: request ?? null } });
});

// POST /sms/templates/:type/preview — preview a template with sample data
smsRouter.post('/templates/:type/preview', async (req: Request, res: Response) => {
  const { template } = z.object({ template: z.string().min(1) }).parse(req.body);

  const preview = fillTemplate(template, {
    tenant_name: 'John Kamau',
    amount:      '25,000',
    unit:        'A1',
    month:       'April 2026',
    due_date:    '5 Apr',
    receipt:     'RCP-ABCD1234',
    paybill:     '303030',
    account_ref: 'A1-DE8AA0',
    property:    'Westgate Court',
  });

  res.json({ success: true, data: { preview, length: preview.length, parts: countSmsParts(preview) } } satisfies ApiResponse<unknown>);
});

// ─── BULK BLAST ───────────────────────────────────────────────────────────────

// GET /sms/blasts — list past blasts
smsRouter.get('/blasts', requireRole('owner', 'manager', 'finance'), async (req: Request, res: Response) => {
  const c   = ctx(req);
  const cid = c.companyId;

  const blasts = await withRLS(c, async (db) => db`
    SELECT b.*, u.full_name AS created_by_name
    FROM sms_blasts b
    JOIN users u ON u.id = b.created_by AND u.company_id = ${cid}
    WHERE b.company_id = ${cid}
    ORDER BY b.created_at DESC
    LIMIT 50
  `);

  res.json({ success: true, data: { blasts } } satisfies ApiResponse<unknown>);
});

// POST /sms/blasts — send a custom bulk SMS
smsRouter.post('/blasts', requireRole('owner', 'manager'), async (req: Request, res: Response) => {
  const c   = ctx(req);
  const cid = c.companyId;

  const { subject, message, target_type, target_id } = z.object({
    subject:     z.string().min(3).max(100),
    message:     z.string().min(5).max(320),
    target_type: z.enum(['all', 'property', 'tenant']),
    target_id:   z.string().uuid().optional(),
  }).parse(req.body);

  if ((target_type === 'property' || target_type === 'tenant') && !target_id) {
    return res.status(400).json({ success: false, error: 'target_id required for property or tenant blast' });
  }

  // Check quota
  const [company] = await withRLS(c, async (db) => db`
    SELECT sms_quota_monthly, sms_used_this_month FROM companies WHERE id = ${cid}
  `);

  // Fetch recipients
  let recipients: any[] = [];

  if (target_type === 'tenant') {
    // Manual single-tenant send: manager override — no lease-status gate, unit/property are metadata only
    recipients = await withRLS(c, async (db) => db`
      SELECT DISTINCT ON (t.id) t.id AS tenant_id, t.phone, t.full_name,
             u.unit_number, p.name AS property_name
      FROM tenants t
      LEFT JOIN leases l ON l.primary_tenant_id = t.id AND l.company_id = ${cid}
      LEFT JOIN units u  ON u.id = l.unit_id AND u.company_id = ${cid}
      LEFT JOIN properties p ON p.id = u.property_id AND p.company_id = ${cid}
      WHERE t.id = ${target_id!} AND t.company_id = ${cid}
        AND t.phone IS NOT NULL AND t.deleted_at IS NULL
      ORDER BY t.id, l.created_at DESC NULLS LAST
    `) as any[];
  } else if (target_type === 'property') {
    recipients = await withRLS(c, async (db) => db`
      SELECT t.id AS tenant_id, t.phone, t.full_name,
             u.unit_number, p.name AS property_name
      FROM tenants t
      JOIN leases l     ON l.primary_tenant_id = t.id AND l.company_id = ${cid} AND l.status IN ('active','notice')
      JOIN units u      ON u.id = l.unit_id AND u.company_id = ${cid}
      JOIN properties p ON p.id = u.property_id AND p.company_id = ${cid}
      WHERE p.id = ${target_id!}
        AND t.company_id = ${cid}
        AND t.phone IS NOT NULL AND t.notify_sms = TRUE
    `) as any[];
  } else {
    recipients = await withRLS(c, async (db) => db`
      SELECT DISTINCT t.id AS tenant_id, t.phone, t.full_name,
             u.unit_number, p.name AS property_name
      FROM tenants t
      JOIN leases l     ON l.primary_tenant_id = t.id AND l.company_id = ${cid} AND l.status IN ('active','notice')
      JOIN units u      ON u.id = l.unit_id AND u.company_id = ${cid}
      JOIN properties p ON p.id = u.property_id AND p.company_id = ${cid}
      WHERE t.company_id = ${cid}
        AND t.phone IS NOT NULL AND t.notify_sms = TRUE
    `) as any[];
  }

  if (recipients.length === 0) {
    return res.status(400).json({ success: false, error: 'No eligible recipients found — check that the tenant has a phone number set, or that the property/group has tenants with phones.' });
  }

  // Quota check
  const remaining = Number(company.sms_quota_monthly) - Number(company.sms_used_this_month);
  if (remaining < recipients.length) {
    return res.status(400).json({
      success: false,
      error: `Insufficient SMS quota. Need ${recipients.length} but only ${remaining} remaining this month. Request a quota increase in SMS Settings.`,
    });
  }

  // Get target label
  let target_label = 'All tenants';
  if (target_type === 'property' && target_id) {
    const [prop] = await withRLS(c, async (db) => db`SELECT name FROM properties WHERE id = ${target_id} AND company_id = ${cid}`);
    target_label = prop?.name ?? 'Property';
  } else if (target_type === 'tenant' && target_id) {
    const [tenant] = await withRLS(c, async (db) => db`SELECT full_name FROM tenants WHERE id = ${target_id} AND company_id = ${cid}`);
    target_label = tenant?.full_name ?? 'Tenant';
  }

  // Create blast record
  const [blast] = await withRLS(c, async (db) => db`
    INSERT INTO sms_blasts (company_id, created_by, subject, message, target_type, target_id, target_label, status)
    VALUES (${cid}, ${c.userId}, ${subject}, ${message}, ${target_type}, ${target_id ?? null}, ${target_label}, 'sending')
    RETURNING *
  `);

  let sent = 0; let failed = 0; let skipped = 0;

  for (const r of recipients) {
    if (!r.phone) { skipped++; continue; }

    const personalised = fillTemplate(message, {
      tenant_name: r.full_name,
      unit:        r.unit_number,
      property:    r.property_name,
      amount:      '', month: '', due_date: '', receipt: '', paybill: '', account_ref: '',
    });

    const result = await sendSms(r.phone, personalised);

    // Log usage
    await withRLS(c, async (db) => db`
      INSERT INTO sms_usage_log (company_id, blast_id, phone, message_length, sms_parts, sender_id_used, status)
      VALUES (${cid}, ${blast.id}, ${r.phone}, ${personalised.length}, ${countSmsParts(personalised)},
              ${process.env.AT_SENDER_ID ?? null}, ${result.success ? 'sent' : 'failed'})
    `).catch(() => {});

    // Log in notifications table too
    await withRLS(c, async (db) => db`
      INSERT INTO notifications (company_id, tenant_id, channel, recipient, body, status,
        attempt_count, last_attempt_at, sent_at, at_message_id, at_error)
      VALUES (${cid}, ${r.tenant_id}, 'sms', ${r.phone}, ${personalised},
        ${result.success ? 'sent' : 'failed'}, 1, NOW(),
        ${result.success ? new Date() : null},
        ${result.messageId ?? null}, ${result.error ?? null})
    `).catch(() => {});

    result.success ? sent++ : failed++;
    await new Promise(r => setTimeout(r, 100));
  }

  // Update blast record
  await withRLS(c, async (db) => db`
    UPDATE sms_blasts SET
      total_sent    = ${sent},
      total_failed  = ${failed},
      total_skipped = ${skipped},
      status        = 'done',
      completed_at  = NOW()
    WHERE id = ${blast.id} AND company_id = ${cid}
  `);

  // Update company usage counter
  await withRLS(c, async (db) => db`
    UPDATE companies SET sms_used_this_month = sms_used_this_month + ${sent}
    WHERE id = ${cid}
  `);

  logger.info({ companyId: cid, blastId: blast.id, sent, failed }, 'Custom SMS blast completed');
  return res.json({ success: true, data: { blast_id: blast.id, sent, failed, skipped, total: recipients.length } } satisfies ApiResponse<unknown>);
});

// GET /sms/recipients-preview — preview who will receive before sending
smsRouter.post('/recipients-preview', requireRole('owner', 'manager'), async (req: Request, res: Response) => {
  const c   = ctx(req);
  const cid = c.companyId;
  const { target_type, target_id } = z.object({
    target_type: z.enum(['all', 'property', 'tenant']),
    target_id:   z.string().uuid().optional(),
  }).parse(req.body);

  let recipients: any[] = [];

  if (target_type === 'tenant' && target_id) {
    // Manual single-tenant: manager override — no lease-status gate
    recipients = await withRLS(c, async (db) => db`
      SELECT DISTINCT ON (t.id) t.full_name, t.phone, u.unit_number, p.name AS property_name
      FROM tenants t
      LEFT JOIN leases l ON l.primary_tenant_id = t.id AND l.company_id = ${cid}
      LEFT JOIN units u  ON u.id = l.unit_id AND u.company_id = ${cid}
      LEFT JOIN properties p ON p.id = u.property_id AND p.company_id = ${cid}
      WHERE t.id = ${target_id} AND t.company_id = ${cid}
        AND t.phone IS NOT NULL AND t.deleted_at IS NULL
      ORDER BY t.id, l.created_at DESC NULLS LAST
    `);
  } else if (target_type === 'property' && target_id) {
    recipients = await withRLS(c, async (db) => db`
      SELECT t.full_name, t.phone, u.unit_number, p.name AS property_name
      FROM tenants t
      JOIN leases l ON l.primary_tenant_id = t.id AND l.company_id = ${cid} AND l.status IN ('active','notice')
      JOIN units u  ON u.id = l.unit_id AND u.company_id = ${cid}
      JOIN properties p ON p.id = u.property_id AND p.company_id = ${cid}
      WHERE p.id = ${target_id}
        AND t.company_id = ${cid}
        AND t.phone IS NOT NULL AND t.notify_sms = TRUE
    `);
  } else {
    recipients = await withRLS(c, async (db) => db`
      SELECT DISTINCT t.full_name, t.phone, u.unit_number, p.name AS property_name
      FROM tenants t
      JOIN leases l ON l.primary_tenant_id = t.id AND l.company_id = ${cid} AND l.status IN ('active','notice')
      JOIN units u  ON u.id = l.unit_id AND u.company_id = ${cid}
      JOIN properties p ON p.id = u.property_id AND p.company_id = ${cid}
      WHERE t.company_id = ${cid} AND t.phone IS NOT NULL AND t.notify_sms = TRUE
    `);
  }

  res.json({ success: true, data: { recipients, count: recipients.length } } satisfies ApiResponse<unknown>);
});