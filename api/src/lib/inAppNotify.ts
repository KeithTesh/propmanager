// api/src/lib/inAppNotify.ts
// Unified in-app alert helpers — all write to inapp_alerts table.
// Always fire-and-forget — never throw, never block the main response.

import { withRLS, RLSContext } from '../db';
import { logger } from './logger';

export interface InAppNotifyOpts {
  type:   string;
  title:  string;
  body:   string;
  link?:  string;
}

async function insertAlert(ctx: RLSContext, userId: string, opts: InAppNotifyOpts) {
  return withRLS(ctx, async (db) => db`
    INSERT INTO inapp_alerts (company_id, user_id, type, title, body, link)
    VALUES (${ctx.companyId}, ${userId}, ${opts.type}, ${opts.title}, ${opts.body}, ${opts.link ?? null})
  `).catch(() => {});
}

export async function notifyOwners(ctx: RLSContext, opts: InAppNotifyOpts): Promise<void> {
  try {
    const users = await withRLS(ctx, async (db) => db`
      SELECT id FROM users
      WHERE company_id = ${ctx.companyId}
        AND role IN ('owner')
        AND is_active = TRUE AND deleted_at IS NULL
    `);
    for (const u of users) await insertAlert(ctx, u.id, opts);
  } catch (err: any) {
    logger.warn({ err: err.message }, 'inAppNotify: notifyOwners failed');
  }
}

export async function notifyManagers(ctx: RLSContext, opts: InAppNotifyOpts): Promise<void> {
  try {
    const users = await withRLS(ctx, async (db) => db`
      SELECT id FROM users
      WHERE company_id = ${ctx.companyId}
        AND role IN ('owner', 'manager')
        AND is_active = TRUE AND deleted_at IS NULL
    `);
    for (const u of users) await insertAlert(ctx, u.id, opts);
  } catch (err: any) {
    logger.warn({ err: err.message }, 'inAppNotify: notifyManagers failed');
  }
}

export async function notifyFinance(ctx: RLSContext, opts: InAppNotifyOpts): Promise<void> {
  try {
    const users = await withRLS(ctx, async (db) => db`
      SELECT id FROM users
      WHERE company_id = ${ctx.companyId}
        AND role IN ('owner', 'finance')
        AND is_active = TRUE AND deleted_at IS NULL
    `);
    for (const u of users) await insertAlert(ctx, u.id, opts);
  } catch (err: any) {
    logger.warn({ err: err.message }, 'inAppNotify: notifyFinance failed');
  }
}

export async function notifyAllStaff(ctx: RLSContext, opts: InAppNotifyOpts): Promise<void> {
  try {
    const users = await withRLS(ctx, async (db) => db`
      SELECT id FROM users
      WHERE company_id = ${ctx.companyId}
        AND role IN ('owner', 'manager', 'finance', 'caretaker')
        AND is_active = TRUE AND deleted_at IS NULL
    `);
    for (const u of users) await insertAlert(ctx, u.id, opts);
  } catch (err: any) {
    logger.warn({ err: err.message }, 'inAppNotify: notifyAllStaff failed');
  }
}

export async function notifyUser(ctx: RLSContext, userId: string, opts: InAppNotifyOpts): Promise<void> {
  try {
    await insertAlert(ctx, userId, opts);
  } catch (err: any) {
    logger.warn({ err: err.message, userId }, 'inAppNotify: notifyUser failed');
  }
}