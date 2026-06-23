// api/src/modules/auth/register.router.ts
// Self-service company registration — no super admin needed
// Creates company + owner account + starts trial automatically

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import type postgres from 'postgres';
import { sql } from '../../db';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { logger } from '../../lib/logger';
import { sendSms } from '../../lib/sms';
import type { ApiResponse } from '../../types';
import { login } from './auth.service';
import { sendWelcomeEmail } from '../../lib/email';

export const registerRouter = Router();

// ── HELPERS ───────────────────────────────────────────────────────────────────

async function getSetting(key: string, fallback: string): Promise<string> {
  try {
    const [row] = await sql`SELECT value FROM platform_settings WHERE key = ${key}`;
    return row?.value ?? fallback;
  } catch { return fallback; }
}

// ── GET /auth/settings — public: trial days, pricing, whatsapp for website ────

registerRouter.get('/settings', async (_req: Request, res: Response) => {
  const keys = ['trial_days','default_sms_quota','starter_price','growth_price',
    'enterprise_price','starter_units','growth_units','whatsapp_number','support_email'];

  const rows = await sql`SELECT key, value FROM platform_settings WHERE key = ANY(${keys})`;
  const settings: Record<string, string> = {};
  rows.forEach((r: any) => { settings[r.key] = r.value; });

  res.json({ success: true, data: { settings } } satisfies ApiResponse<unknown>);
});

// ── POST /auth/register — self-service company signup ─────────────────────────

registerRouter.post('/register', async (req: Request, res: Response) => {
  const body = z.object({
    companyName: z.string().min(2, 'Company name is required'),
    fullName:    z.string().min(2, 'Your name is required'),
    email:       z.string().email('Invalid email address'),
    phone:       z.string().min(9, 'Valid phone number required'),
    password:    z.string().min(8, 'Password must be at least 8 characters'),
    county:      z.string().optional(),
    accountType: z.enum(['landlord','agent']).default('landlord'),
  }).parse(req.body);

  const email = body.email.toLowerCase().trim();

  // Check company email not taken
  const [existingCompany] = await sql`
    SELECT id FROM companies WHERE email = ${email} AND deleted_at IS NULL
  `;
  if (existingCompany) {
    res.status(409).json({
      success: false,
      error: { code: 'EMAIL_TAKEN', message: 'An account with this email already exists. Please sign in instead.' },
    });
    return;
  }

  // Check user email not taken
  const [existingUser] = await sql`
    SELECT id FROM users WHERE email = ${email} AND deleted_at IS NULL
  `;
  if (existingUser) {
    res.status(409).json({
      success: false,
      error: { code: 'EMAIL_TAKEN', message: 'An account with this email already exists. Please sign in instead.' },
    });
    return;
  }

  // Get trial days from platform settings
  const trialDays = parseInt(await getSetting('trial_days', '7'), 10);
  const smsQuota  = parseInt(await getSetting('default_sms_quota', '500'), 10);

  const trialEnds = new Date();
  trialEnds.setDate(trialEnds.getDate() + trialDays);

  const companyId = randomUUID();
  const userId    = randomUUID();
  const pwHash    = await bcrypt.hash(body.password, 12);

  // Normalise phone — strip leading 0, add 254
  const phone = body.phone.replace(/\s+/g, '').replace(/^0/, '254').replace(/^\+/, '');

  // Create company + owner in a transaction
  // postgres.js's TransactionSql type loses its call signature via `Omit` (TS bug),
  // so it can't type-check as a tagged-template tag — cast through Sql instead.
  await sql.begin(async (rawTx) => {
    const tx = rawTx as unknown as postgres.Sql;
    // 1. Create company
    await tx`
      INSERT INTO companies (
        id, name, email, phone, county,
        plan, subscription_status, trial_ends_at,
        sms_quota_monthly, unit_limit, monthly_fee,
        setup_completed, setup_current_step,
        account_type
      ) VALUES (
        ${companyId}, ${body.companyName}, ${email}, ${phone}, ${body.county ?? null},
        'trial', 'trialing', ${trialEnds.toISOString()},
        ${smsQuota}, 50, 0,
        false, 1,
        ${body.accountType}
      )
    `;

    // 2. Create owner user
    await tx`
      INSERT INTO users (
        id, company_id, email, phone, full_name,
        role, password_hash, is_active
      ) VALUES (
        ${userId}, ${companyId}, ${email}, ${phone}, ${body.fullName},
        'owner', ${pwHash}, true
      )
    `;

    // 3. Log subscription event
    await tx`
      INSERT INTO subscription_events (company_id, event_type, new_status, new_plan, notes, performed_by)
      VALUES (${companyId}, 'trial_started', 'trialing', 'trial',
        ${`${trialDays}-day free trial started via self-service signup`}, ${userId})
    `;

    // 4. Create setup progress rows — different steps for landlord vs agent
    const isAgent = body.accountType === 'agent';
    const setupSteps = isAgent
      ? [
          [1, 'company_profile'],
          [2, 'payment_config'],
          [3, 'add_landlord_client'],
          [4, 'add_property'],
          [5, 'commission_settings'],
          [6, 'add_tenant'],
        ]
      : [
          [1, 'company_profile'],
          [2, 'payment_config'],
          [3, 'add_property'],
          [4, 'add_unit'],
          [5, 'add_tenant'],
          [6, 'create_lease'],
        ];

    for (const [num, name] of setupSteps) {
      await tx`
        INSERT INTO company_setup_progress (id, company_id, step_number, step_name, status)
        VALUES (${randomUUID()}, ${companyId}, ${num}, ${name}, 'pending')
        ON CONFLICT (company_id, step_number) DO NOTHING
      `;
    }
  });

  logger.info({ companyId, userId, email, trialDays }, 'New company registered via self-service');

  // Send welcome SMS (non-blocking)
  sendSms(phone,
    `Welcome to PropManager, ${body.fullName.split(' ')[0]}! Your ${trialDays}-day free trial has started. ` +
    `Log in at propmanager.co.ke to set up your properties. Need help? WhatsApp us.`
  ).catch(e => logger.warn({ e }, 'Welcome SMS failed — non-critical'));

  sendWelcomeEmail({ to: email, ownerName: body.fullName, companyName: body.companyName, trialDays, loginUrl: `${process.env.APP_URL ?? 'http://localhost:3000'}/login` }).catch(() => {});

  // Auto-login after registration — return tokens so frontend can go straight to setup
  const session = await login(email, body.password);

  // Set refresh token cookie (same as login endpoint)
  res.cookie('pm_refresh', session.tokens.refreshToken, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge:   7 * 24 * 60 * 60 * 1000,
    path:     '/',
  });

  res.status(201).json({
    success: true,
    data: {
      message:     'Account created successfully',
      companyId,
      userId,
      trialDays,
      trialEndsAt: trialEnds.toISOString(),
      redirectTo:  '/setup',
      // Auth session — same shape as /auth/login response
      user:    session.user,
      company: session.company,
      tokens: {
        accessToken: session.tokens.accessToken,
        expiresIn:   session.tokens.expiresIn,
      },
    },
  } satisfies ApiResponse<unknown>);
});