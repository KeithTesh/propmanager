// api/src/middleware/subscription.ts
// Blocks API access for suspended or cancelled companies
// Super admins bypass this entirely

import { Request, Response, NextFunction } from 'express';
import { sql } from '../db';

export async function requireActiveSubscription(
  req: Request, res: Response, next: NextFunction
): Promise<void> {
  // Super admins always pass
  if (req.ctx.userRole === 'super_admin') { next(); return; }
  // Tenant portal passes — tenants can always view their bills
  if (req.ctx.userRole === 'tenant') { next(); return; }

  const companyId = req.ctx.companyId;
  if (!companyId) { next(); return; }

  const [company] = await sql`
    SELECT subscription_status, suspension_reason, trial_ends_at
    FROM companies WHERE id = ${companyId}
  `;

  if (!company) { next(); return; }

  if (company.subscription_status === 'suspended') {
    res.status(403).json({
      success: false,
      error: {
        code: 'SUBSCRIPTION_SUSPENDED',
        message: `Your account has been suspended. Reason: ${company.suspension_reason ?? 'Contact support'}. Please contact PropManager support to reactivate.`,
      },
    });
    return;
  }

  if (company.subscription_status === 'cancelled') {
    res.status(403).json({
      success: false,
      error: {
        code: 'SUBSCRIPTION_CANCELLED',
        message: 'Your subscription has been cancelled. Please contact PropManager support.',
      },
    });
    return;
  }

  // Trial expired — give read-only access (block mutations)
  if (company.subscription_status === 'trialing' && company.trial_ends_at) {
    const trialExpired = new Date(company.trial_ends_at) < new Date();
    if (trialExpired && ['POST','PATCH','PUT','DELETE'].includes(req.method)) {
      res.status(403).json({
        success: false,
        error: {
          code: 'TRIAL_EXPIRED',
          message: 'Your free trial has expired. Please contact PropManager to activate your subscription.',
        },
      });
      return;
    }
  }

  next();
}