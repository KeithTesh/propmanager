// api/src/modules/notifications/alerts.router.ts

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { withRLS, RLSContext } from '../../db';
import type { ApiResponse } from '../../types';

export const alertsRouter = Router();
// NOTE: authenticate is applied at server level — do NOT add it here again

function ctx(req: Request): RLSContext {
  return { companyId: req.ctx.companyId!, userId: req.ctx.userId, userRole: req.ctx.userRole };
}

// Helper — call from other routers to push alerts to staff
export async function createAlert(
  db: any,
  companyId: string,
  userIds: string[],
  alert: { type: string; title: string; body: string; link?: string }
) {
  if (!userIds.length) return;
  for (const userId of userIds) {
    await db`
      INSERT INTO inapp_alerts (company_id, user_id, type, title, body, link)
      VALUES (${companyId}, ${userId}, ${alert.type}, ${alert.title}, ${alert.body}, ${alert.link ?? null})
    `;
  }
}

// ─── STATIC ROUTES FIRST (must be before /:id routes) ────────────────────────

// GET /alerts/unread-count
alertsRouter.get('/unread-count', async (req: Request, res: Response) => {
  const c = ctx(req);
  const [row] = await withRLS(c, async (db) => db`
    SELECT COUNT(*) AS count FROM inapp_alerts
    WHERE user_id    = ${c.userId}
      AND company_id = ${c.companyId}
      AND read_at IS NULL
  `);
  res.json({ success: true, data: { unread_count: Number(row?.count ?? 0) } } satisfies ApiResponse);
});

// POST /alerts/read-all
alertsRouter.post('/read-all', async (req: Request, res: Response) => {
  const c = ctx(req);
  const result = await withRLS(c, async (db) => db`
    UPDATE inapp_alerts SET read_at = NOW()
    WHERE user_id    = ${c.userId}
      AND company_id = ${c.companyId}
      AND read_at IS NULL
    RETURNING id
  `);
  res.json({ success: true, data: { marked: result.length } } satisfies ApiResponse);
});

// POST /alerts/test
alertsRouter.post('/test', async (req: Request, res: Response) => {
  const c = ctx(req);
  const { type = 'system', title, body, link } = z.object({
    type:  z.string().optional(),
    title: z.string().min(1).default('Test Alert'),
    body:  z.string().min(1).default('Your in-app alert system is working! ✓'),
    link:  z.string().optional(),
  }).parse(req.body);

  const [alert] = await withRLS(c, async (db) => db`
    INSERT INTO inapp_alerts (company_id, user_id, type, title, body, link)
    VALUES (${c.companyId}, ${c.userId}, ${type}, ${title}, ${body}, ${link ?? null})
    RETURNING *
  `);
  res.status(201).json({ success: true, data: { alert } } satisfies ApiResponse);
});

// ─── GET /alerts ──────────────────────────────────────────────────────────────

alertsRouter.get('/', async (req: Request, res: Response) => {
  const { unread_only } = req.query;
  const c = ctx(req);
  const alerts = await withRLS(c, async (db) => db`
    SELECT * FROM inapp_alerts
    WHERE user_id    = ${c.userId}
      AND company_id = ${c.companyId}
      ${unread_only === 'true' ? db`AND read_at IS NULL` : db``}
    ORDER BY created_at DESC
    LIMIT 50
  `);
  const unread_count = alerts.filter((a: any) => !a.read_at).length;
  res.json({ success: true, data: { alerts, unread_count } } satisfies ApiResponse);
});

// ─── PARAM ROUTES LAST ────────────────────────────────────────────────────────

// POST /alerts/:id/read
alertsRouter.post('/:id/read', async (req: Request, res: Response) => {
  const c = ctx(req);
  await withRLS(c, async (db) => db`
    UPDATE inapp_alerts SET read_at = NOW()
    WHERE id         = ${req.params.id}
      AND user_id    = ${c.userId}
      AND company_id = ${c.companyId}
      AND read_at IS NULL
  `);
  res.json({ success: true, data: { read: true } } satisfies ApiResponse);
});

// DELETE /alerts/:id
alertsRouter.delete('/:id', async (req: Request, res: Response) => {
  const c = ctx(req);
  await withRLS(c, async (db) => db`
    DELETE FROM inapp_alerts
    WHERE id         = ${req.params.id}
      AND user_id    = ${c.userId}
      AND company_id = ${c.companyId}
  `);
  res.json({ success: true, data: { deleted: true } } satisfies ApiResponse);
});