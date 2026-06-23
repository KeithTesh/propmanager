// api/src/modules/companies/companies.router.ts

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { sql } from '../../db';
import { authenticate, requireRole } from '../../middleware/auth';
import { NotFoundError, ConflictError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { ApiResponse } from '../../types';

import { setupRouter } from './setup.router';

export const companiesRouter = Router();

// Mount setup wizard routes — accessible before setup completes
companiesRouter.use('/setup', setupRouter);

// All company routes require authentication
companiesRouter.use(authenticate);

// ─── POST /companies — super_admin creates a new company + first admin ────────

const CreateCompanySchema = z.object({
  // Company
  name:               z.string().min(2, 'Company name required'),
  tradingName:        z.string().optional(),
  phone:              z.string().min(9, 'Valid phone required'),
  email:              z.string().email('Valid email required'),
  county:             z.string().optional(),
  address:            z.string().optional(),
  registrationNumber: z.string().optional(),
  kraPin:             z.string().optional(),

  // First admin user
  adminName:          z.string().min(2, 'Admin name required'),
  adminEmail:         z.string().email('Valid admin email required'),
  adminPhone:         z.string().min(9, 'Valid admin phone required'),
  adminPassword:      z.string().min(8, 'Password must be at least 8 characters'),
});

companiesRouter.post('/', requireRole('super_admin'), async (req: Request, res: Response) => {
  const data = CreateCompanySchema.parse(req.body);

  // Check for duplicate company email
  const [existingCompany] = await sql`
    SELECT id FROM companies WHERE email = lower(${data.email}) AND deleted_at IS NULL
  `;
  if (existingCompany) throw new ConflictError('A company with this email already exists');

  // Check for duplicate admin email
  const [existingUser] = await sql`
    SELECT id FROM users WHERE email = lower(${data.adminEmail}) AND deleted_at IS NULL
  `;
  if (existingUser) throw new ConflictError('A user with this email already exists');

  const companyId = randomUUID();
  const adminId   = randomUUID();
  const passwordHash = await bcrypt.hash(data.adminPassword, 12);

  // Create company + admin in a single transaction
  await sql.begin(async (trx) => {
    await trx`
      INSERT INTO companies (
        id, name, trading_name, phone, email,
        county, address, registration_number, kra_pin,
        setup_completed, setup_current_step
      ) VALUES (
        ${companyId},
        ${data.name},
        ${data.tradingName ?? null},
        ${data.phone},
        ${data.email.toLowerCase()},
        ${data.county ?? null},
        ${data.address ?? null},
        ${data.registrationNumber ?? null},
        ${data.kraPin ?? null},
        FALSE,
        1
      )
    `;

    await trx`
      INSERT INTO users (
        id, company_id, role, email, password_hash,
        full_name, phone, is_active
      ) VALUES (
        ${adminId},
        ${companyId},
        'owner',
        ${data.adminEmail.toLowerCase()},
        ${passwordHash},
        ${data.adminName},
        ${data.adminPhone},
        TRUE
      )
    `;
  });

  logger.info({ companyId, adminId }, 'Company created by super_admin');

  res.status(201).json({
    success: true,
    data: {
      company: { id: companyId, name: data.name, email: data.email },
      admin:   { id: adminId,   name: data.adminName, email: data.adminEmail },
    },
  } satisfies ApiResponse<unknown>);
});

// ─── GET /companies — super_admin lists all companies ─────────────────────────

companiesRouter.get('/', requireRole('super_admin'), async (_req: Request, res: Response) => {
  const companies = await sql`
    SELECT
      c.id,
      c.name,
      c.trading_name,
      c.email,
      c.phone,
      c.county,
      c.setup_completed,
      c.setup_current_step,
      c.payment_method,
      c.created_at,
      -- counts
      COUNT(DISTINCT p.id)                                          AS property_count,
      COUNT(DISTINCT u.id)                                          AS unit_count,
      COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'active')      AS active_lease_count,
      -- admin user
      MAX(usr.full_name)  AS admin_name,
      MAX(usr.email)      AS admin_email
    FROM companies c
    LEFT JOIN properties p   ON p.company_id = c.id AND p.deleted_at IS NULL
    LEFT JOIN units u        ON u.company_id = c.id AND u.deleted_at IS NULL
    LEFT JOIN leases l       ON l.company_id = c.id
    LEFT JOIN users usr      ON usr.company_id = c.id AND usr.role = 'owner' AND usr.deleted_at IS NULL
    WHERE c.deleted_at IS NULL
    GROUP BY c.id
    ORDER BY c.created_at DESC
  `;

  res.json({
    success: true,
    data: { companies },
  } satisfies ApiResponse<unknown>);
});

// ─── GET /companies/:id — get single company detail ───────────────────────────

companiesRouter.get('/:id', requireRole('super_admin', 'owner'), async (req: Request, res: Response) => {
  const { id } = req.params;

  // company_admin can only fetch their own company
  if (req.ctx.user.role === 'owner' && req.ctx.companyId !== id) {
    throw new NotFoundError('Company not found');
  }

  const [company] = await sql`
    SELECT * FROM companies WHERE id = ${id} AND deleted_at IS NULL
  `;

  if (!company) throw new NotFoundError('Company not found');

  res.json({ success: true, data: { company } } satisfies ApiResponse<unknown>);
});


// ─── GET /companies/me/limit — unit usage for current company ─────────────────

companiesRouter.get('/me/limit', async (req: Request, res: Response) => {
  const companyId = req.ctx.companyId!;
  const [company] = await sql`
    SELECT units_used, unit_limit, plan, subscription_status
    FROM companies WHERE id = ${companyId} AND deleted_at IS NULL
  `;
  if (!company) throw new NotFoundError('Company not found');
  res.json({ success: true, data: company } satisfies ApiResponse<unknown>);
});

// ─── PATCH /companies/:id/settings — owner updates their company settings ─────

const UpdateSettingsSchema = z.object({
  // Identity
  name:               z.string().min(2).optional(),
  tradingName:        z.string().optional().nullable(),
  phone:              z.string().optional(),
  email:              z.string().email().optional(),
  address:            z.string().optional().nullable(),
  county:             z.string().optional().nullable(),
  registrationNumber: z.string().optional().nullable(),
  kraPin:             z.string().optional().nullable(),

  // Payment
  paymentMethod:      z.enum(['bank_paybill','daraja_stk','cash','manual']).optional(),
  paybillNumber:      z.string().optional().nullable(),
  paybillAccountFormat: z.string().optional().nullable(),
  bankName:           z.string().optional().nullable(),
  bankAccountNumber:  z.string().optional().nullable(),
  bankBranch:         z.string().optional().nullable(),

  // Proration
  moveInProrationMode:   z.enum(['always','after_cutoff','never']).optional().nullable(),
  moveInProrationCutoff: z.number().int().min(1).max(28).optional().nullable(),
  moveInProrationMethod: z.enum(['actual_days','standard_30']).optional().nullable(),
  moveOutProrationMode:  z.enum(['full_month','to_notice_date','to_actual_date']).optional().nullable(),
  billFirstPartialMonth: z.boolean().optional(),
  minProrationThreshold: z.number().int().min(0).optional(),

  // AT / SMS
  atSenderId:         z.string().max(11).optional().nullable(),
  atUsername:         z.string().optional().nullable(),
  atApiKey:           z.string().optional().nullable(),

  // Notification preferences
  ownerNotifySms:     z.boolean().optional(),
  ownerNotifyEmail:   z.boolean().optional(),

  // Billing
  dueDay:               z.number().int().min(1).max(28).optional(),
  gracePeriodDays:      z.number().int().min(0).optional(),
  penaltyType:          z.enum(['none','flat','percentage']).optional(),
  penaltyValue:         z.number().min(0).optional(),
  penaltyAppliesAfterDays: z.number().int().min(0).optional(),
});

companiesRouter.patch('/:id/settings', requireRole('super_admin', 'owner', 'manager'), async (req: Request, res: Response) => {
  const { id } = req.params;

  // owners can only update their own company
  if (req.ctx.user.role !== 'super_admin' && req.ctx.companyId !== id) {
    throw new NotFoundError('Company not found');
  }

  const data = UpdateSettingsSchema.parse(req.body);

  const [updated] = await sql`
    UPDATE companies SET
      name                    = COALESCE(${data.name               ?? null}, name),
      trading_name            = COALESCE(${data.tradingName        ?? null}, trading_name),
      phone                   = COALESCE(${data.phone              ?? null}, phone),
      email                   = COALESCE(${data.email              ?? null}, email),
      address                 = COALESCE(${data.address            ?? null}, address),
      county                  = COALESCE(${data.county             ?? null}, county),
      registration_number     = COALESCE(${data.registrationNumber ?? null}, registration_number),
      kra_pin                 = COALESCE(${data.kraPin             ?? null}, kra_pin),

      payment_method          = COALESCE(${data.paymentMethod      ?? null}, payment_method),
      paybill_number          = COALESCE(${data.paybillNumber      ?? null}, paybill_number),
      paybill_account_format  = COALESCE(${data.paybillAccountFormat ?? null}, paybill_account_format),
      bank_name               = COALESCE(${data.bankName           ?? null}, bank_name),
      bank_account_number     = COALESCE(${data.bankAccountNumber  ?? null}, bank_account_number),
      bank_branch             = COALESCE(${data.bankBranch         ?? null}, bank_branch),

      move_in_proration_mode    = COALESCE(${data.moveInProrationMode   ?? null}, move_in_proration_mode),
      move_in_proration_cutoff  = COALESCE(${data.moveInProrationCutoff ?? null}, move_in_proration_cutoff),
      move_in_proration_method  = COALESCE(${data.moveInProrationMethod ?? null}, move_in_proration_method),
      move_out_proration_mode   = COALESCE(${data.moveOutProrationMode  ?? null}, move_out_proration_mode),
      bill_first_partial_month  = COALESCE(${data.billFirstPartialMonth ?? null}, bill_first_partial_month),
      min_proration_threshold   = COALESCE(${data.minProrationThreshold ?? null}, min_proration_threshold),

      due_day                   = COALESCE(${data.dueDay                 ?? null}, due_day),
      grace_period_days         = COALESCE(${data.gracePeriodDays        ?? null}, grace_period_days),
      penalty_type              = COALESCE(${data.penaltyType             ?? null}, penalty_type),
      penalty_value             = COALESCE(${data.penaltyValue            ?? null}, penalty_value),
      penalty_applies_after_days= COALESCE(${data.penaltyAppliesAfterDays ?? null}, penalty_applies_after_days),

      at_sender_id            = COALESCE(${data.atSenderId       ?? null}, at_sender_id),
      at_username             = COALESCE(${data.atUsername        ?? null}, at_username),
      at_api_key              = COALESCE(${data.atApiKey          ?? null}, at_api_key),
      owner_notify_sms        = COALESCE(${data.ownerNotifySms    ?? null}, owner_notify_sms),
      owner_notify_email      = COALESCE(${data.ownerNotifyEmail  ?? null}, owner_notify_email),

      updated_at = NOW()
    WHERE id = ${id} AND deleted_at IS NULL
    RETURNING id, name, email, phone, payment_method, due_day, setup_completed, owner_notify_sms, owner_notify_email, at_sender_id,
              owner_notify_sms, owner_notify_email, at_sender_id
  `;

  if (!updated) throw new NotFoundError('Company not found');
  logger.info({ companyId: id }, 'Company settings updated');
  res.json({ success: true, data: { company: updated } } satisfies ApiResponse<unknown>);
});