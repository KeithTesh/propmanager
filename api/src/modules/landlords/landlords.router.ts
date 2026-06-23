// api/src/modules/landlords/landlords.router.ts

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { sql, withRLS, withRLSTransaction } from '../../db';
import { authenticate } from '../../middleware/auth';
import { NotFoundError, ForbiddenError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { sendSms } from '../../lib/sms';
import type { ApiResponse, RLSContext } from '../../types';

export const landlordsRouter = Router();
landlordsRouter.use(authenticate);

function ctx(req: Request): RLSContext {
  return { companyId: req.ctx.companyId!, userId: req.ctx.userId, userRole: req.ctx.userRole };
}

// Guard — only agent companies can use this module
async function requireAgent(req: Request) {
  const [co] = await sql`SELECT account_type FROM companies WHERE id = ${req.ctx.companyId!} AND deleted_at IS NULL`;
  if (co?.account_type !== 'agent') {
    throw new ForbiddenError('This feature is only available for agent accounts.');
  }
}

// Only owner can create/edit/delete landlord clients
function requireOwner(req: Request) {
  if (!['owner'].includes(req.ctx.userRole)) {
    throw new ForbiddenError('Only the account owner can manage landlord clients.');
  }
}

// Owner, manager, accountant can view
function requireViewRole(req: Request) {
  if (!['owner','manager','accountant'].includes(req.ctx.userRole)) {
    throw new ForbiddenError('Access denied.');
  }
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const CreateLandlordSchema = z.object({
  fullName:        z.string().min(2),
  phone:           z.string().optional().nullable(),
  email:           z.string().email().optional().nullable(),
  kraPin:          z.string().optional().nullable(),
  bankName:        z.string().optional().nullable(),
  bankAccount:     z.string().optional().nullable(),
  bankBranch:      z.string().optional().nullable(),
  commissionType:  z.enum(['flat','percentage']).default('percentage'),
  commissionValue: z.number().min(0).default(10),
  notes:           z.string().optional().nullable(),
});

const UpdateLandlordSchema = CreateLandlordSchema.partial();

const CommissionOverrideSchema = z.object({
  propertyId:      z.string().uuid(),
  commissionType:  z.enum(['flat','percentage']),
  commissionValue: z.number().min(0),
});

// ── GET /landlords ────────────────────────────────────────────────────────────

landlordsRouter.get('/', async (req: Request, res: Response) => {
  await requireAgent(req);
  requireViewRole(req);
  const c = ctx(req);

  const landlords = await withRLS(c, async (db) => db`
    SELECT
      l.id, l.full_name, l.phone, l.email, l.kra_pin,
      l.bank_name, l.bank_account, l.bank_branch,
      l.commission_type, l.commission_value,
      l.status, l.notes, l.created_at,
      l.user_id IS NOT NULL AS has_portal_access,

      -- Portfolio stats
      COUNT(DISTINCT p.id)                                     AS property_count,
      COUNT(DISTINCT u.id)                                     AS unit_count,
      COUNT(DISTINCT u.id) FILTER (
        WHERE lse.status = 'active'
      )                                                        AS occupied_units,

      -- This month collections
      COALESCE(SUM(pay.amount) FILTER (
        WHERE pay.created_at >= DATE_TRUNC('month', NOW())
          AND pay.status = 'confirmed'
      ), 0)                                                    AS collected_this_month

    FROM landlords l
    LEFT JOIN properties p    ON p.landlord_id = l.id AND p.deleted_at IS NULL
    LEFT JOIN units u         ON u.property_id = p.id AND u.deleted_at IS NULL
    LEFT JOIN leases lse      ON lse.unit_id = u.id AND lse.status = 'active'
    LEFT JOIN monthly_bills b ON b.lease_id = lse.id
    LEFT JOIN payments pay    ON pay.company_id = ${c.companyId} AND pay.bill_id = b.id

    WHERE l.company_id = ${c.companyId} AND l.deleted_at IS NULL
    GROUP BY l.id
    ORDER BY l.full_name ASC
  `);

  res.json({ success: true, data: { landlords } } satisfies ApiResponse<unknown>);
});

// ── GET /landlords/:id ────────────────────────────────────────────────────────

landlordsRouter.get('/:id', async (req: Request, res: Response) => {
  await requireAgent(req);
  requireViewRole(req);
  const c   = ctx(req);
  const { id } = req.params;

  const [landlord] = await withRLS(c, async (db) => db`
    SELECT
      l.*,
      l.user_id IS NOT NULL AS has_portal_access,
      u_portal.email AS portal_email
    FROM landlords l
    LEFT JOIN users u_portal ON u_portal.id = l.user_id
    WHERE l.id = ${id} AND l.company_id = ${c.companyId} AND l.deleted_at IS NULL
  `);

  if (!landlord) throw new NotFoundError('Landlord client not found');

  // Properties under this landlord
  const properties = await withRLS(c, async (db) => db`
    SELECT
      p.id, p.name, p.address, p.county,
      COUNT(DISTINCT u.id)                                        AS unit_count,
      COUNT(DISTINCT u.id) FILTER (WHERE lse.status = 'active')  AS occupied_units,
      co.commission_type  AS override_commission_type,
      co.commission_value AS override_commission_value
    FROM properties p
    LEFT JOIN units u         ON u.property_id = p.id AND u.deleted_at IS NULL
    LEFT JOIN leases lse      ON lse.unit_id = u.id AND lse.status = 'active'
    LEFT JOIN commission_overrides co
              ON co.property_id = p.id AND co.landlord_id = ${id}
    WHERE p.landlord_id = ${id} AND p.company_id = ${c.companyId} AND p.deleted_at IS NULL
    GROUP BY p.id, co.commission_type, co.commission_value
    ORDER BY p.name
  `);

  // This month summary
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const [monthStats] = await withRLS(c, async (db) => db`
    SELECT
      COALESCE(SUM(b.amount), 0)                              AS total_billed,
      COALESCE(SUM(pay.amount) FILTER (
        WHERE pay.status = 'confirmed'
      ), 0)                                                   AS total_collected
    FROM properties p
    JOIN units u          ON u.property_id = p.id AND u.deleted_at IS NULL
    JOIN leases lse       ON lse.unit_id = u.id AND lse.status = 'active'
    JOIN monthly_bills b  ON b.lease_id = lse.id
      AND DATE_TRUNC('month', b.due_date) = DATE_TRUNC('month', NOW())
    LEFT JOIN payments pay ON pay.bill_id = b.id AND pay.company_id = ${c.companyId}
    WHERE p.landlord_id = ${id} AND p.company_id = ${c.companyId} AND p.deleted_at IS NULL
  `);

  res.json({ success: true, data: { landlord, properties, monthStats } } satisfies ApiResponse<unknown>);
});

// ── POST /landlords ───────────────────────────────────────────────────────────

landlordsRouter.post('/', async (req: Request, res: Response) => {
  await requireAgent(req);
  requireOwner(req);
  const c   = ctx(req);
  const body = CreateLandlordSchema.parse(req.body);

  const [landlord] = await withRLS(c, async (db) => db`
    INSERT INTO landlords (
      company_id, full_name, phone, email, kra_pin,
      bank_name, bank_account, bank_branch,
      commission_type, commission_value, notes
    ) VALUES (
      ${c.companyId}, ${body.fullName}, ${body.phone ?? null}, ${body.email ?? null},
      ${body.kraPin ?? null}, ${body.bankName ?? null}, ${body.bankAccount ?? null},
      ${body.bankBranch ?? null}, ${body.commissionType}, ${body.commissionValue},
      ${body.notes ?? null}
    )
    RETURNING *
  `);

  logger.info({ companyId: c.companyId, landlordId: landlord.id }, 'Landlord client created');
  res.status(201).json({ success: true, data: { landlord } } satisfies ApiResponse<unknown>);
});

// ── PATCH /landlords/:id ──────────────────────────────────────────────────────

landlordsRouter.patch('/:id', async (req: Request, res: Response) => {
  await requireAgent(req);
  requireOwner(req);
  const c   = ctx(req);
  const { id } = req.params;
  const body = UpdateLandlordSchema.parse(req.body);

  const [existing] = await withRLS(c, async (db) => db`
    SELECT id FROM landlords WHERE id = ${id} AND company_id = ${c.companyId} AND deleted_at IS NULL
  `);
  if (!existing) throw new NotFoundError('Landlord client not found');

  const [updated] = await withRLS(c, async (db) => db`
    UPDATE landlords SET
      full_name        = COALESCE(${body.fullName        ?? null}, full_name),
      phone            = COALESCE(${body.phone           ?? null}, phone),
      email            = COALESCE(${body.email           ?? null}, email),
      kra_pin          = COALESCE(${body.kraPin          ?? null}, kra_pin),
      bank_name        = COALESCE(${body.bankName        ?? null}, bank_name),
      bank_account     = COALESCE(${body.bankAccount     ?? null}, bank_account),
      bank_branch      = COALESCE(${body.bankBranch      ?? null}, bank_branch),
      commission_type  = COALESCE(${body.commissionType  ?? null}, commission_type),
      commission_value = COALESCE(${body.commissionValue ?? null}, commission_value),
      notes            = COALESCE(${body.notes           ?? null}, notes),
      updated_at       = NOW()
    WHERE id = ${id} AND company_id = ${c.companyId}
    RETURNING *
  `);

  res.json({ success: true, data: { landlord: updated } } satisfies ApiResponse<unknown>);
});

// ── DELETE /landlords/:id ─────────────────────────────────────────────────────

landlordsRouter.delete('/:id', async (req: Request, res: Response) => {
  await requireAgent(req);
  requireOwner(req);
  const c   = ctx(req);
  const { id } = req.params;

  // Cannot delete if properties are still assigned
  const [propCount] = await withRLS(c, async (db) => db`
    SELECT COUNT(*) AS count FROM properties
    WHERE landlord_id = ${id} AND company_id = ${c.companyId} AND deleted_at IS NULL
  `);
  if (Number(propCount?.count) > 0) {
    res.status(409).json({
      success: false,
      error: { code: 'HAS_PROPERTIES', message: 'Remove all property assignments before deleting this landlord client.' }
    });
    return;
  }

  await withRLS(c, async (db) => db`
    UPDATE landlords SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = ${id} AND company_id = ${c.companyId}
  `);

  res.json({ success: true, data: { message: 'Landlord client deleted' } } satisfies ApiResponse<unknown>);
});

// ── POST /landlords/:id/invite ────────────────────────────────────────────────

landlordsRouter.post('/:id/invite', async (req: Request, res: Response) => {
  await requireAgent(req);
  requireOwner(req);
  const c   = ctx(req);
  const { id } = req.params;

  const [co] = await sql`SELECT name FROM companies WHERE id = ${c.companyId}`;

  const [landlord] = await withRLS(c, async (db) => db`
    SELECT id, full_name, phone, email, user_id
    FROM landlords
    WHERE id = ${id} AND company_id = ${c.companyId} AND deleted_at IS NULL
  `);

  if (!landlord) throw new NotFoundError('Landlord client not found');

  if (landlord.user_id) {
    res.status(409).json({
      success: false,
      error: { code: 'ALREADY_INVITED', message: 'This landlord client already has portal access.' }
    });
    return;
  }

  if (!landlord.email && !landlord.phone) {
    res.status(400).json({
      success: false,
      error: { code: 'NO_CONTACT', message: 'Add an email or phone number before sending an invitation.' }
    });
    return;
  }

  // Generate temp password
  const tempPassword = Math.random().toString(36).slice(-8).toUpperCase();
  const bcryptMod    = await import('bcryptjs');
  const bcrypt       = bcryptMod.default ?? bcryptMod;
  const hash         = await bcrypt.hash(tempPassword, 10);
  const loginEmail   = landlord.email ?? `${landlord.phone}@landlord.propmanager.co.ke`;

  await withRLSTransaction(c, async (tx) => {
    const userId = randomUUID();
    await tx`
      INSERT INTO users (id, company_id, email, phone, full_name, role, password_hash, is_active)
      VALUES (
        ${userId}, ${c.companyId}, ${loginEmail}, ${landlord.phone ?? null},
        ${landlord.full_name}, 'landlord_client', ${hash}, true
      )
    `;
    await tx`
      UPDATE landlords SET user_id = ${userId}, invited_by = ${c.userId}, updated_at = NOW()
      WHERE id = ${id}
    `;
  });

  // Send credentials via SMS
  if (landlord.phone) {
    sendSms(
      landlord.phone,
      `Hi ${landlord.full_name.split(' ')[0]}, ${co.name} has set up your landlord portal on PropManager. ` +
      `Login: ${loginEmail} Password: ${tempPassword} at propmanager.co.ke/landlord-portal`
    ).catch(() => {});
  }

  logger.info({ companyId: c.companyId, landlordId: id }, 'Landlord portal invitation sent');
  res.json({
    success: true,
    data: { message: 'Portal invitation sent', loginEmail, tempPassword }
  } satisfies ApiResponse<unknown>);
});

// ── GET /landlords/:id/portfolio ──────────────────────────────────────────────

landlordsRouter.get('/:id/portfolio', async (req: Request, res: Response) => {
  await requireAgent(req);
  requireViewRole(req);
  const c   = ctx(req);
  const { id } = req.params;

  const [landlord] = await withRLS(c, async (db) => db`
    SELECT id, full_name, commission_type, commission_value
    FROM landlords
    WHERE id = ${id} AND company_id = ${c.companyId} AND deleted_at IS NULL
  `);
  if (!landlord) throw new NotFoundError('Landlord client not found');

  // Per-property stats this month
  const properties = await withRLS(c, async (db) => db`
    SELECT
      p.id, p.name, p.address,
      COUNT(DISTINCT u.id)                                        AS unit_count,
      COUNT(DISTINCT u.id) FILTER (WHERE lse.status = 'active')  AS occupied_units,
      COALESCE(SUM(b.amount)  FILTER (
        WHERE DATE_TRUNC('month', b.due_date) = DATE_TRUNC('month', NOW())
      ), 0)                                                       AS billed_this_month,
      COALESCE(SUM(pay.amount) FILTER (
        WHERE pay.status = 'confirmed'
          AND DATE_TRUNC('month', pay.created_at) = DATE_TRUNC('month', NOW())
      ), 0)                                                       AS collected_this_month,
      co.commission_type  AS override_type,
      co.commission_value AS override_value
    FROM properties p
    LEFT JOIN units u         ON u.property_id = p.id AND u.deleted_at IS NULL
    LEFT JOIN leases lse      ON lse.unit_id = u.id AND lse.status = 'active'
    LEFT JOIN monthly_bills b ON b.lease_id = lse.id
    LEFT JOIN payments pay    ON pay.bill_id = b.id AND pay.company_id = ${c.companyId}
    LEFT JOIN commission_overrides co
              ON co.property_id = p.id AND co.landlord_id = ${id}
    WHERE p.landlord_id = ${id} AND p.company_id = ${c.companyId} AND p.deleted_at IS NULL
    GROUP BY p.id, co.commission_type, co.commission_value
    ORDER BY p.name
  `);

  res.json({ success: true, data: { landlord, properties } } satisfies ApiResponse<unknown>);
});

// ── POST /landlords/:id/commission-override ───────────────────────────────────

landlordsRouter.post('/:id/commission-override', async (req: Request, res: Response) => {
  await requireAgent(req);
  requireOwner(req);
  const c   = ctx(req);
  const { id } = req.params;
  const body = CommissionOverrideSchema.parse(req.body);

  // Verify landlord exists and property belongs to this landlord
  const [prop] = await withRLS(c, async (db) => db`
    SELECT p.id FROM properties p
    WHERE p.id = ${body.propertyId}
      AND p.landlord_id = ${id}
      AND p.company_id = ${c.companyId}
      AND p.deleted_at IS NULL
  `);
  if (!prop) {
    res.status(404).json({
      success: false,
      error: { message: 'Property not found or not assigned to this landlord.' }
    });
    return;
  }

  const [override] = await withRLS(c, async (db) => db`
    INSERT INTO commission_overrides (company_id, landlord_id, property_id, commission_type, commission_value)
    VALUES (${c.companyId}, ${id}, ${body.propertyId}, ${body.commissionType}, ${body.commissionValue})
    ON CONFLICT (landlord_id, property_id) DO UPDATE SET
      commission_type  = EXCLUDED.commission_type,
      commission_value = EXCLUDED.commission_value,
      updated_at       = NOW()
    RETURNING *
  `);

  res.json({ success: true, data: { override } } satisfies ApiResponse<unknown>);
});

// ── DELETE /landlords/:id/commission-override/:propertyId ─────────────────────

landlordsRouter.delete('/:id/commission-override/:propertyId', async (req: Request, res: Response) => {
  await requireAgent(req);
  requireOwner(req);
  const c   = ctx(req);
  const { id, propertyId } = req.params;

  await withRLS(c, async (db) => db`
    DELETE FROM commission_overrides
    WHERE landlord_id = ${id} AND property_id = ${propertyId} AND company_id = ${c.companyId}
  `);

  res.json({ success: true, data: { message: 'Commission override removed. Landlord rate will apply.' } } satisfies ApiResponse<unknown>);
});