// api/src/modules/companies/setup.router.ts

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { sql } from '../../db';
import { authenticate } from '../../middleware/auth';
import { ForbiddenError, NotFoundError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { ApiResponse } from '../../types';

export const setupRouter = Router();

setupRouter.use(authenticate);

// Only owner role can run setup
function requireOwner(req: Request) {
  if (req.ctx.user.role !== 'owner') {
    throw new ForbiddenError('Only the company owner can complete setup');
  }
}

// ─── GET /companies/setup — get current setup state ──────────────────────────

setupRouter.get('/', async (req: Request, res: Response) => {
  requireOwner(req);
  const companyId = req.ctx.companyId!;

  const [company] = await sql`
    SELECT
      id, name, trading_name, phone, email, address, county,
      registration_number, kra_pin,
      payment_method, paybill_number, paybill_account_format,
      till_number, bank_name, bank_account_number, bank_branch,
      move_in_proration_mode, move_in_proration_cutoff,
      move_in_proration_method, move_out_proration_mode,
      bill_first_partial_month, min_proration_threshold,
      due_day, grace_period_days, penalty_type, penalty_value,
      penalty_applies_after_days,
      sms_sender_id, reminder_days_before, reminder_days_after,
      setup_completed, setup_current_step
    FROM companies
    WHERE id = ${companyId} AND deleted_at IS NULL
  `;

  if (!company) throw new NotFoundError('Company not found');

  res.json({ success: true, data: { company } } satisfies ApiResponse<unknown>);
});

// ─── Step schemas ─────────────────────────────────────────────────────────────

const Step1Schema = z.object({
  name:               z.string().min(2),
  tradingName:        z.string().optional().nullable(),
  phone:              z.string().min(9),
  email:              z.string().email(),
  address:            z.string().optional().nullable(),
  county:             z.string().optional().nullable(),
  registrationNumber: z.string().optional().nullable(),
  kraPin:             z.string().optional().nullable(),
});

const Step2Schema = z.object({
  paymentMethod:        z.enum(['bank_paybill', 'daraja_stk', 'cash', 'manual']),
  paybillNumber:        z.string().optional().nullable(),
  paybillAccountFormat: z.string().optional().nullable(),
  tillNumber:           z.string().optional().nullable(),
  bankName:             z.string().optional().nullable(),
  bankAccountNumber:    z.string().optional().nullable(),
  bankBranch:           z.string().optional().nullable(),
});

const Step3Schema = z.object({
  dueDay:                 z.number().int().min(1).max(28),
  gracePeriodDays:        z.number().int().min(0).max(30),
  penaltyType:            z.enum(['none', 'flat', 'percentage']),
  penaltyValue:           z.number().min(0).optional().nullable(),
  penaltyAppliesAfterDays:z.number().int().min(0).optional().nullable(),
});

const Step4Schema = z.object({
  moveInProrationMode:    z.enum(['always', 'after_cutoff', 'never']),
  moveInProrationCutoff:  z.number().int().min(1).max(28).optional().nullable(),
  moveInProrationMethod:  z.enum(['actual_days', 'standard_30']),
  moveOutProrationMode:   z.enum(['full_month', 'to_notice_date', 'to_actual_date']),
  billFirstPartialMonth:  z.boolean(),
  minProrationThreshold:  z.number().int().min(0),
});

const Step5Schema = z.object({
  smsSenderId:        z.string().optional().nullable(),
  reminderDaysBefore: z.array(z.number().int()).optional(),
  reminderDaysAfter:  z.array(z.number().int()).optional(),
});

// ─── POST /companies/setup/:step ─────────────────────────────────────────────

setupRouter.post('/:step', async (req: Request, res: Response) => {
  requireOwner(req);
  const companyId = req.ctx.companyId!;
  const step = parseInt(req.params.step, 10);

  if (isNaN(step) || step < 1 || step > 5) {
    res.status(400).json({ success: false, error: { message: 'Invalid step number' } });
    return;
  }

  let updateQuery: Record<string, unknown> = {};
  let stepName = '';

  switch (step) {
    case 1: {
      const d = Step1Schema.parse(req.body);
      stepName = 'company_profile';
      updateQuery = {
        name:                d.name,
        trading_name:        d.tradingName ?? null,
        phone:               d.phone,
        email:               d.email.toLowerCase(),
        address:             d.address ?? null,
        county:              d.county ?? null,
        registration_number: d.registrationNumber ?? null,
        kra_pin:             d.kraPin ?? null,
      };
      break;
    }
    case 2: {
      const d = Step2Schema.parse(req.body);
      stepName = 'payment_method';
      updateQuery = {
        payment_method:         d.paymentMethod,
        paybill_number:         d.paybillNumber ?? null,
        paybill_account_format: d.paybillAccountFormat ?? null,
        till_number:            d.tillNumber ?? null,
        bank_name:              d.bankName ?? null,
        bank_account_number:    d.bankAccountNumber ?? null,
        bank_branch:            d.bankBranch ?? null,
      };
      break;
    }
    case 3: {
      const d = Step3Schema.parse(req.body);
      stepName = 'billing_config';
      updateQuery = {
        due_day:                   d.dueDay,
        grace_period_days:         d.gracePeriodDays,
        penalty_type:              d.penaltyType,
        penalty_value:             d.penaltyValue ?? 0,
        penalty_applies_after_days:d.penaltyAppliesAfterDays ?? 0,
      };
      break;
    }
    case 4: {
      const d = Step4Schema.parse(req.body);
      stepName = 'proration_settings';
      updateQuery = {
        move_in_proration_mode:   d.moveInProrationMode,
        move_in_proration_cutoff: d.moveInProrationCutoff ?? null,
        move_in_proration_method: d.moveInProrationMethod,
        move_out_proration_mode:  d.moveOutProrationMode,
        bill_first_partial_month: d.billFirstPartialMonth,
        min_proration_threshold:  d.minProrationThreshold,
      };
      break;
    }
    case 5: {
      const d = Step5Schema.parse(req.body);
      stepName = 'notifications';
      updateQuery = {
        sms_sender_id:        d.smsSenderId ?? null,
        reminder_days_before: d.reminderDaysBefore ?? [7, 3, 0],
        reminder_days_after:  d.reminderDaysAfter ?? [3],
      };
      break;
    }
  }

  const isLastStep = step === 5;
  const nextStep   = isLastStep ? 5 : step + 1;

  // Update company fields
  await sql`
    UPDATE companies SET
      ${sql(updateQuery)},
      setup_current_step = ${nextStep},
      setup_completed    = ${isLastStep},
      updated_at         = NOW()
    WHERE id = ${companyId}
  `;

  // Record progress
  await sql`
    INSERT INTO company_setup_progress
      (company_id, step_number, step_name, status, completed_at, data_snapshot)
    VALUES
      (${companyId}, ${step}, ${stepName}, 'completed', NOW(), ${JSON.stringify(req.body)}::jsonb)
    ON CONFLICT (company_id, step_number)
    DO UPDATE SET
      status       = 'completed',
      completed_at = NOW(),
      data_snapshot = ${JSON.stringify(req.body)}::jsonb
  `;

  logger.info({ companyId, step, stepName }, 'Setup step completed');

  res.json({
    success: true,
    data: {
      step,
      stepName,
      nextStep,
      setupCompleted: isLastStep,
    },
  } satisfies ApiResponse<unknown>);
});