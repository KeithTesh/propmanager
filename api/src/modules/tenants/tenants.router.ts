// api/src/modules/tenants/tenants.router.ts

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { withRLS, withRLSTransaction } from '../../db';
import { authenticate } from '../../middleware/auth';
import { NotFoundError, ValidationError } from '../../lib/errors';
import { sendSms } from '../../lib/sms';
import { sendTenantInviteEmail } from '../../lib/email';
import { logger } from '../../lib/logger';
import type { ApiResponse, RLSContext } from '../../types';

export const tenantsRouter = Router();
tenantsRouter.use(authenticate);

function ctx(req: Request): RLSContext {
  return { companyId: req.ctx.companyId!, userId: req.ctx.userId, userRole: req.ctx.userRole };
}

const TenantSchema = z.object({
  fullName:              z.string().min(2, 'Full name required'),
  phone:                 z.string().min(9, 'Phone number required'),
  email:                 z.string().email().optional().nullable(),
  phoneMpesa:            z.string().optional().nullable(),
  nationalId:            z.string().optional().nullable(),
  kraPin:                z.string().optional().nullable(),
  isCorporate:           z.boolean().optional().default(false),
  companyName:           z.string().optional().nullable(),
  emergencyContactName:  z.string().optional().nullable(),
  emergencyContactPhone: z.string().optional().nullable(),
  notes:                 z.string().optional().nullable(),
  notifySms:             z.boolean().optional().default(true),
  notifyEmail:           z.boolean().optional().default(false),
});

// ─── GET /tenants ─────────────────────────────────────────────────────────────

tenantsRouter.get('/', async (req: Request, res: Response) => {
  const { search } = req.query;

  const tenants = await withRLS(ctx(req), async (db) => {
    if (search) {
      return db`
        SELECT
          t.*,
          COUNT(l.id) FILTER (WHERE l.status = 'active') AS active_leases,
          MAX(u.unit_number)  AS unit_number,
          MAX(p.name)         AS property_name
        FROM tenants t
        LEFT JOIN leases l ON l.primary_tenant_id = t.id
        LEFT JOIN units u  ON u.id = l.unit_id AND l.status = 'active'
        LEFT JOIN properties p ON p.id = u.property_id
        WHERE t.company_id = ${req.ctx.companyId}
          AND t.deleted_at IS NULL
          AND (
            t.full_name ILIKE ${'%' + search + '%'}
            OR t.phone   ILIKE ${'%' + search + '%'}
            OR t.email   ILIKE ${'%' + search + '%'}
            OR t.national_id ILIKE ${'%' + search + '%'}
          )
        GROUP BY t.id
        ORDER BY t.full_name
      `;
    }
    return db`
      SELECT
        t.*,
        COUNT(l.id) FILTER (WHERE l.status = 'active') AS active_leases,
        MAX(u.unit_number)  AS unit_number,
        MAX(p.name)         AS property_name
      FROM tenants t
      LEFT JOIN leases l ON l.primary_tenant_id = t.id
      LEFT JOIN units u  ON u.id = l.unit_id AND l.status = 'active'
      LEFT JOIN properties p ON p.id = u.property_id
      WHERE t.company_id = ${req.ctx.companyId}
        AND t.deleted_at IS NULL
      GROUP BY t.id
      ORDER BY t.full_name
    `;
  });

  res.json({ success: true, data: { tenants } } satisfies ApiResponse<unknown>);
});

// ─── GET /tenants/:id ─────────────────────────────────────────────────────────

tenantsRouter.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await withRLS(ctx(req), async (db) => {
    const [tenant] = await db`
      SELECT t.*
      FROM tenants t
      WHERE t.id = ${id} AND t.company_id = ${req.ctx.companyId} AND t.deleted_at IS NULL
    `;
    if (!tenant) return null;

    const leases = await db`
      SELECT
        l.id, l.status, l.start_date, l.end_date,
        l.monthly_rent, l.deposit_amount,
        u.unit_number, p.name AS property_name
      FROM leases l
      JOIN units u ON u.id = l.unit_id
      JOIN properties p ON p.id = u.property_id
      WHERE l.primary_tenant_id = ${id} AND l.company_id = ${req.ctx.companyId}
      ORDER BY l.created_at DESC
    `;

    return { ...tenant, leases };
  });

  if (!result) throw new NotFoundError('Tenant not found');
  res.json({ success: true, data: { tenant: result } } satisfies ApiResponse<unknown>);
});

// ─── POST /tenants ────────────────────────────────────────────────────────────

tenantsRouter.post('/', async (req: Request, res: Response) => {
  const data      = TenantSchema.parse(req.body);
  const id        = randomUUID();
  const companyId = req.ctx.companyId!;

  await withRLS(ctx(req), async (db) => {
    // Duplicate check — scoped to this company only
    const dupeConditions = [];
    if (data.phone)      dupeConditions.push(`phone = '${data.phone}'`);
    if (data.email)      dupeConditions.push(`email = '${data.email.toLowerCase()}'`);
    if (data.nationalId) dupeConditions.push(`national_id = '${data.nationalId}'`);

    if (dupeConditions.length > 0) {
      const [existing] = await db`
        SELECT id, full_name, phone, email, national_id
        FROM tenants
        WHERE company_id = ${companyId}
          AND deleted_at IS NULL
          AND (
            ${data.phone      ? db`phone       = ${data.phone}`                    : db`FALSE`}
            OR ${data.email   ? db`email       = ${data.email.toLowerCase()}`      : db`FALSE`}
            OR ${data.nationalId ? db`national_id = ${data.nationalId}`            : db`FALSE`}
          )
        LIMIT 1
      `;
      if (existing) {
        const field = existing.phone === data.phone ? 'phone number'
          : existing.email === data.email?.toLowerCase() ? 'email address'
          : 'national ID';
        throw new ValidationError(`A tenant with this ${field} (${existing.full_name}) already exists in your company`);
      }
    }

    await db`
      INSERT INTO tenants (
        id, company_id, full_name, phone, email, phone_mpesa,
        national_id, kra_pin, is_corporate, company_name,
        emergency_contact_name, emergency_contact_phone,
        notes, notify_sms, notify_email
      ) VALUES (
        ${id}, ${companyId}, ${data.fullName}, ${data.phone},
        ${data.email ?? null}, ${data.phoneMpesa ?? null},
        ${data.nationalId ?? null}, ${data.kraPin ?? null},
        ${data.isCorporate ?? false}, ${data.companyName ?? null},
        ${data.emergencyContactName ?? null}, ${data.emergencyContactPhone ?? null},
        ${data.notes ?? null}, ${data.notifySms ?? true}, ${data.notifyEmail ?? false}
      )
    `;
  });

  logger.info({ tenantId: id, companyId }, 'Tenant created');
  res.status(201).json({ success: true, data: { tenant: { id, fullName: data.fullName } } } satisfies ApiResponse<unknown>);
});

// ─── PATCH /tenants/:id ───────────────────────────────────────────────────────

tenantsRouter.patch('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const data   = TenantSchema.partial().parse(req.body);

  const [updated] = await withRLS(ctx(req), async (db) => {
    return db`
      UPDATE tenants SET
        full_name              = COALESCE(${data.fullName              ?? null}, full_name),
        phone                  = COALESCE(${data.phone                 ?? null}, phone),
        email                  = COALESCE(${data.email                 ?? null}, email),
        phone_mpesa            = COALESCE(${data.phoneMpesa            ?? null}, phone_mpesa),
        national_id            = COALESCE(${data.nationalId            ?? null}, national_id),
        kra_pin                = COALESCE(${data.kraPin                ?? null}, kra_pin),
        is_corporate           = COALESCE(${data.isCorporate           ?? null}, is_corporate),
        company_name           = COALESCE(${data.companyName           ?? null}, company_name),
        emergency_contact_name = COALESCE(${data.emergencyContactName  ?? null}, emergency_contact_name),
        emergency_contact_phone= COALESCE(${data.emergencyContactPhone ?? null}, emergency_contact_phone),
        notes                  = COALESCE(${data.notes                 ?? null}, notes),
        notify_sms             = COALESCE(${data.notifySms             ?? null}, notify_sms),
        notify_email           = COALESCE(${data.notifyEmail           ?? null}, notify_email),
        updated_at             = NOW()
      WHERE id = ${id} AND company_id = ${req.ctx.companyId} AND deleted_at IS NULL
      RETURNING id, full_name
    `;
  });

  if (!updated) throw new NotFoundError('Tenant not found');
  res.json({ success: true, data: { tenant: updated } } satisfies ApiResponse<unknown>);
});

// ─── DELETE /tenants/:id ──────────────────────────────────────────────────────

tenantsRouter.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  await withRLSTransaction(ctx(req), async (tx) => {
    const [active] = await tx`
      SELECT COUNT(*) AS count FROM leases
      WHERE primary_tenant_id = ${id} AND company_id = ${req.ctx.companyId} AND status = 'active'
    `;
    if (parseInt(active.count) > 0) {
      throw new Error('Cannot archive a tenant with an active lease. End the lease first.');
    }
    await tx`
      UPDATE tenants SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = ${id} AND deleted_at IS NULL
    `;
  });

  logger.info({ tenantId: id }, 'Tenant archived');
  res.json({ success: true, data: { message: 'Tenant archived' } } satisfies ApiResponse<unknown>);
});

// ─── POST /tenants/:id/invite ─────────────────────────────────────────────────

tenantsRouter.post('/:id/invite', async (req: Request, res: Response) => {
  const { id } = req.params;
  const companyId = req.ctx.companyId!;

  const [tenant] = await withRLS(ctx(req), async (db) => db`
    SELECT t.id, t.full_name, t.phone, t.email, t.user_id,
      c.name AS company_name,
      u.unit_number
    FROM tenants t
    JOIN companies c ON c.id = t.company_id
    LEFT JOIN leases l ON l.primary_tenant_id = t.id AND l.status = 'active'
    LEFT JOIN units u ON u.id = l.unit_id
    WHERE t.id = ${id} AND t.company_id = ${companyId} AND t.deleted_at IS NULL
    LIMIT 1
  `);

  if (!tenant) throw new NotFoundError('Tenant not found');

  if (tenant.user_id) {
    res.status(409).json({ success: false, error: { code: 'ALREADY_INVITED', message: 'Tenant already has portal access.' } });
    return;
  }

  if (!tenant.email && !tenant.phone) {
    res.status(400).json({ success: false, error: { code: 'NO_CONTACT', message: 'Tenant needs an email or phone to receive credentials.' } });
    return;
  }

  // Generate temp password
  const tempPassword = Math.random().toString(36).slice(-8).toUpperCase();
  const bcryptMod = await import('bcryptjs');
  const bcrypt = bcryptMod.default ?? bcryptMod;
  const hash = await bcrypt.hash(tempPassword, 10);
  const loginEmail = tenant.email ?? `${tenant.phone}@tenant.propmanager.co.ke`;

  await withRLSTransaction(ctx(req), async (tx) => {
    const userId = randomUUID();
    await tx`
      INSERT INTO users (id, company_id, email, phone, full_name, role, password_hash, is_active)
      VALUES (${userId}, ${companyId}, ${loginEmail}, ${tenant.phone ?? null}, ${tenant.full_name}, 'tenant', ${hash}, true)
    `;
    await tx`UPDATE tenants SET user_id = ${userId}, updated_at = NOW() WHERE id = ${id}`;
  });

  // Send credentials
  const unitLabel = tenant.unit_number ? `Unit ${tenant.unit_number}` : 'your unit';
  if (tenant.phone) {
    sendSms(tenant.phone,
      `Hi ${tenant.full_name.split(' ')[0]}, your tenant portal is ready. ` +
      `Login: ${loginEmail} Password: ${tempPassword} at propmanager.co.ke/portal`
    ).catch(() => {});
  }
  if (tenant.email) {
    sendTenantInviteEmail({
      to: tenant.email, tenantName: tenant.full_name, companyName: tenant.company_name,
      unitNumber: unitLabel, tempPassword,
      portalUrl: `${process.env.APP_URL ?? 'http://localhost:3000'}/portal`,
    }).catch(() => {});
  }

  logger.info({ tenantId: id, companyId }, 'Tenant portal invitation sent');
  res.json({ success: true, data: { message: 'Credentials sent', loginEmail, tempPassword } } satisfies ApiResponse<unknown>);
});