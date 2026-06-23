// api/src/modules/subscription/subscription.router.ts
// IntaSend-powered subscription payments
// npm install intasend-node

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { sql } from '../../db';
import { withRLS } from '../../db';
import { authenticate } from '../../middleware/auth';
import { randomUUID } from 'crypto';
import { logger } from '../../lib/logger';
import type { ApiResponse, RLSContext } from '../../types';
import { sendSubscriptionActivatedEmail } from '../../lib/email';

export const subscriptionRouter = Router();

const INTASEND_BASE = process.env.INTASEND_TEST === 'true'
  ? 'https://sandbox.intasend.com'
  : 'https://payment.intasend.com';

const PLAN_PRICES: Record<string, number> = {
  starter:    2500,
  growth:     5500,
  enterprise: 12000,
};

const PLAN_UNITS: Record<string, number> = {
  starter:    50,
  growth:     200,
  enterprise: 999999,
};

function ctx(req: Request): RLSContext {
  return { companyId: req.ctx.companyId!, userId: req.ctx.userId, userRole: req.ctx.userRole };
}

// ── GET /subscription/status ─── current subscription state ──────────────────

subscriptionRouter.get('/status', authenticate, async (req: Request, res: Response) => {
  const companyId = req.ctx.companyId!;
  const [company] = await sql`
    SELECT plan, subscription_status, trial_ends_at, subscription_ends_at,
           next_billing_at, monthly_fee, unit_limit, units_used, suspended_at, suspension_reason
    FROM companies WHERE id = ${companyId}
  `;

  const [lastPayment] = await sql`
    SELECT id, plan, amount, status, initiated_at, completed_at
    FROM subscription_payments
    WHERE company_id = ${companyId}
    ORDER BY initiated_at DESC LIMIT 1
  `;

  const trialDaysLeft = company.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(company.trial_ends_at).getTime() - Date.now()) / 86400000))
    : null;

  res.json({ success: true, data: { company, lastPayment: lastPayment ?? null, trialDaysLeft } } satisfies ApiResponse<unknown>);
});

// ── POST /subscription/pay — trigger M-Pesa STK push for subscription ─────────

subscriptionRouter.post('/pay', authenticate, async (req: Request, res: Response) => {
  const { plan, phone } = z.object({
    plan:  z.enum(['starter', 'growth', 'enterprise']),
    phone: z.string().min(9),
  }).parse(req.body);

  const companyId = req.ctx.companyId!;
  const amount    = PLAN_PRICES[plan];

  // Normalise phone
  const normPhone = phone.replace(/\s+/g, '').replace(/^0/, '254').replace(/^\+/, '');

  // Get company info
  const [company] = await sql`SELECT name, email FROM companies WHERE id = ${companyId}`;
  if (!company) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Company not found' } }); return; }

  // Check no pending payment already
  const [pending] = await sql`
    SELECT id FROM subscription_payments
    WHERE company_id = ${companyId} AND status = 'pending'
      AND initiated_at > NOW() - INTERVAL '10 minutes'
  `;
  if (pending) {
    res.status(409).json({
      success: false,
      error: { code: 'PAYMENT_PENDING', message: 'A payment is already in progress. Please check your phone for the M-Pesa prompt.' },
    });
    return;
  }

  // Create payment record
  const paymentId = randomUUID();
  const apiRef    = `PM-${companyId.slice(0, 8).toUpperCase()}-${Date.now()}`;

  await sql`
    INSERT INTO subscription_payments (id, company_id, plan, amount, channel, api_ref, phone, status)
    VALUES (${paymentId}, ${companyId}, ${plan}, ${amount}, 'mpesa', ${apiRef}, ${normPhone}, 'pending')
  `;

  // Fire IntaSend STK push
  try {
    const stkRes = await fetch(`${INTASEND_BASE}/api/v1/payment/collection/`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.INTASEND_SECRET_KEY}`,
      },
      body: JSON.stringify({
        public_key:   process.env.INTASEND_PUBLISHABLE_KEY,
        currency:     'KES',
        method:       'M-PESA',
        amount:       amount,
        phone_number: normPhone,
        email:        company.email,
        first_name:   company.name,
        api_ref:      apiRef,
        narrative:    `PropManager ${plan.charAt(0).toUpperCase() + plan.slice(1)} subscription`,
      }),
    });

    const stkData: any = await stkRes.json();

    if (!stkRes.ok) {
      logger.error({ stkData, plan, companyId }, 'IntaSend STK push failed');
      await sql`UPDATE subscription_payments SET status = 'failed', failure_reason = ${JSON.stringify(stkData)} WHERE id = ${paymentId}`;
      res.status(502).json({ success: false, error: { code: 'STK_FAILED', message: 'Could not initiate M-Pesa payment. Please try again.' } });
      return;
    }

    // Store IntaSend invoice ID
    await sql`
      UPDATE subscription_payments SET
        intasend_invoice_id  = ${stkData.invoice?.id ?? null},
        intasend_tracking_id = ${stkData.invoice?.invoice_id ?? null},
        status               = 'processing'
      WHERE id = ${paymentId}
    `;

    logger.info({ companyId, plan, amount, apiRef }, 'STK push initiated');
    res.json({
      success: true,
      data: {
        message:   'M-Pesa payment request sent to your phone. Enter your PIN to complete.',
        paymentId,
        apiRef,
        amount,
        plan,
      },
    } satisfies ApiResponse<unknown>);

  } catch (err) {
    logger.error({ err, companyId }, 'IntaSend API error');
    await sql`UPDATE subscription_payments SET status = 'failed', failure_reason = 'Network error' WHERE id = ${paymentId}`;
    res.status(502).json({ success: false, error: { code: 'GATEWAY_ERROR', message: 'Payment gateway unavailable. Please try again shortly.' } });
  }
});

// ── GET /subscription/pay/:paymentId/status — poll payment status ─────────────

subscriptionRouter.get('/pay/:paymentId/status', authenticate, async (req: Request, res: Response) => {
  const { paymentId } = req.params;
  const companyId = req.ctx.companyId!;

  const [payment] = await sql`
    SELECT id, status, plan, amount, completed_at, failure_reason
    FROM subscription_payments
    WHERE id = ${paymentId} AND company_id = ${companyId}
  `;

  if (!payment) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Payment not found' } }); return; }

  res.json({ success: true, data: { payment } } satisfies ApiResponse<unknown>);
});

// ── POST /webhooks/intasend — IntaSend payment webhook ────────────────────────
// Register this URL in your IntaSend dashboard:
// https://yourapi.com/api/v1/webhooks/intasend

subscriptionRouter.post('/webhook', async (req: Request, res: Response) => {
  // IntaSend sends webhook to this endpoint — no auth middleware
  const payload = req.body;
  logger.info({ payload }, 'IntaSend webhook received');

  try {
    const apiRef  = payload?.invoice?.api_ref ?? payload?.api_ref;
    const state   = (payload?.invoice?.state ?? payload?.state ?? '').toUpperCase();
    const invoiceId = payload?.invoice?.id ?? payload?.id;

    if (!apiRef) {
      res.status(200).json({ received: true }); // acknowledge but don't process
      return;
    }

    const [payment] = await sql`
      SELECT * FROM subscription_payments WHERE api_ref = ${apiRef}
    `;

    if (!payment) {
      logger.warn({ apiRef }, 'IntaSend webhook: no matching payment found');
      res.status(200).json({ received: true });
      return;
    }

    // Store raw webhook
    await sql`
      UPDATE subscription_payments SET webhook_payload = ${payload} WHERE id = ${payment.id}
    `;

    if (state === 'COMPLETE' || state === 'COMPLETED') {
      await activateSubscription(payment);
    } else if (state === 'FAILED' || state === 'CANCELLED') {
      await sql`
        UPDATE subscription_payments SET
          status         = 'failed',
          failure_reason = ${state},
          expired_at     = NOW()
        WHERE id = ${payment.id}
      `;
      logger.info({ paymentId: payment.id, state }, 'Payment failed/cancelled');
    }

    res.status(200).json({ received: true });

  } catch (err) {
    logger.error({ err }, 'IntaSend webhook processing error');
    res.status(200).json({ received: true }); // always 200 to stop retries
  }
});

// ── ACTIVATE SUBSCRIPTION ─────────────────────────────────────────────────────

async function activateSubscription(payment: any) {
  const billingDays = payment.billing_days ?? 30;
  const subEnds     = new Date();
  subEnds.setDate(subEnds.getDate() + billingDays);

  const monthlyFee = PLAN_PRICES[payment.plan] ?? 0;
  const unitLimit  = PLAN_UNITS[payment.plan] ?? 50;

  await sql.begin(async (tx) => {
    // 1. Mark payment completed
    await tx`
      UPDATE subscription_payments SET
        status       = 'completed',
        completed_at = NOW()
      WHERE id = ${payment.id}
    `;

    // 2. Activate company subscription
    await tx`
      UPDATE companies SET
        plan                 = ${payment.plan},
        subscription_status  = 'active',
        suspended_at         = NULL,
        suspension_reason    = NULL,
        monthly_fee          = ${monthlyFee},
        unit_limit           = ${unitLimit},
        subscription_ends_at = ${subEnds.toISOString()},
        next_billing_at      = ${subEnds.toISOString()},
        last_billed_at       = NOW(),
        updated_at           = NOW()
      WHERE id = ${payment.company_id}
    `;

    // 3. Log event
    const [company] = await tx`SELECT subscription_status, plan FROM companies WHERE id = ${payment.company_id}`;
    await tx`
      INSERT INTO subscription_events
        (company_id, event_type, old_status, new_status, old_plan, new_plan, amount, notes)
      VALUES
        (${payment.company_id}, 'payment_received', ${company?.subscription_status ?? 'trialing'},
         'active', ${company?.plan ?? 'trial'}, ${payment.plan},
         ${payment.amount}, 'Activated via IntaSend M-Pesa payment')
    `;
  });

  // Send confirmation SMS + email (respecting notify prefs)
  const [company] = await sql`
    SELECT c.name, c.phone, c.email, c.owner_notify_sms, c.owner_notify_email
    FROM companies c WHERE c.id = ${payment.company_id}
  `;
  const [owner] = await sql`
    SELECT full_name, email, phone FROM users
    WHERE company_id = ${payment.company_id} AND role = 'owner' AND deleted_at IS NULL LIMIT 1
  `;
  const planName = payment.plan.charAt(0).toUpperCase() + payment.plan.slice(1);

  // SMS notification
  if (company?.owner_notify_sms !== false && (owner?.phone || company?.phone)) {
    await sendActivationSms(owner?.phone || company?.phone, company?.name, planName, billingDays);
  }

  // Email notification
  if (company?.owner_notify_email !== false && (owner?.email || company?.email)) {
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + billingDays);
    await sendSubscriptionActivatedEmail({
      to: owner?.email || company?.email,
      ownerName: owner?.full_name || company?.name,
      companyName: company?.name,
      plan: payment.plan,
      amount: parseFloat(payment.amount),
      nextBillingDate: nextDate.toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' }),
    }).catch(() => {});
  }

  logger.info({ companyId: payment.company_id, plan: payment.plan }, 'Subscription activated via IntaSend');
}

async function sendActivationSms(phone: string, companyName: string, plan: string, days: number) {
  try {
    const { sendSms } = await import('../../lib/sms');
    await sendSms(phone,
      `✅ PropManager ${plan} plan activated for ${companyName}! ` +
      `Your subscription is active for ${days} days. ` +
      `Thank you for choosing PropManager.`
    );
  } catch (e) {
    logger.warn({ e }, 'Activation SMS failed — non-critical');
  }
}