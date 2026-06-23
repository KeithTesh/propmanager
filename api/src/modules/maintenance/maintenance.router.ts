// api/src/modules/maintenance/maintenance.router.ts

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { withRLS } from '../../db';
import { authenticate } from '../../middleware/auth';
import { NotFoundError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { ApiResponse, RLSContext } from '../../types';

export const maintenanceRouter = Router();
maintenanceRouter.use(authenticate);

function ctx(req: Request): RLSContext {
  return { companyId: req.ctx.companyId!, userId: req.ctx.userId, userRole: req.ctx.userRole };
}

const PRIORITIES = ['low','medium','high','urgent'] as const;
const STATUSES   = ['open','acknowledged','in_progress','resolved','closed'] as const;
const CATEGORIES = ['plumbing','electrical','structural','cleaning','appliance','security','other'] as const;

// ─── GET /maintenance ─────────────────────────────────────────────────────────

maintenanceRouter.get('/', async (req: Request, res: Response) => {
  const { status, priority, propertyId } = req.query as Record<string, string | undefined>;

  const requests = await withRLS(ctx(req), async (db) => {
    return db`
      SELECT
        m.*,
        p.name       AS property_name,
        u.unit_number,
        rep.full_name AS reported_by_name,
        asgn.full_name AS assigned_to_name
      FROM maintenance_requests m
      JOIN properties p   ON p.id = m.property_id
      LEFT JOIN units u   ON u.id = m.unit_id
      LEFT JOIN users rep  ON rep.id  = m.reported_by
      LEFT JOIN users asgn ON asgn.id = m.assigned_to
      WHERE TRUE
        ${status     ? db`AND m.status      = ${status}`     : db`AND m.status != 'closed'`}
        ${priority   ? db`AND m.priority    = ${priority}`   : db``}
        ${propertyId ? db`AND m.property_id = ${propertyId}` : db``}
      ORDER BY
        CASE m.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        m.reported_at DESC
      LIMIT 200
    `;
  });

  res.json({ success: true, data: { requests } } satisfies ApiResponse<unknown>);
});

// ─── GET /maintenance/summary ─────────────────────────────────────────────────

maintenanceRouter.get('/summary', async (req: Request, res: Response) => {
  const summary = await withRLS(ctx(req), async (db) => {
    const [row] = await db`
      SELECT
        COUNT(*) FILTER (WHERE status != 'closed')                              AS open_count,
        COUNT(*) FILTER (WHERE status != 'closed' AND priority = 'urgent')     AS urgent_count,
        COUNT(*) FILTER (WHERE status = 'open')                                AS unacknowledged,
        COUNT(*) FILTER (WHERE status = 'resolved' AND resolved_at > NOW() - INTERVAL '30 days') AS resolved_30d
      FROM maintenance_requests
    `;
    return row;
  });
  res.json({ success: true, data: { summary } } satisfies ApiResponse<unknown>);
});

// ─── POST /maintenance ────────────────────────────────────────────────────────

const CreateSchema = z.object({
  propertyId:  z.string().uuid(),
  unitId:      z.string().uuid().optional().nullable(),
  title:       z.string().min(3),
  description: z.string().optional().nullable(),
  priority:    z.enum(PRIORITIES).default('medium'),
  category:    z.enum(CATEGORIES).default('other'),
  assignedTo:  z.string().uuid().optional().nullable(),
});

maintenanceRouter.post('/', async (req: Request, res: Response) => {
  const data = CreateSchema.parse(req.body);
  const id   = randomUUID();

  await withRLS(ctx(req), async (db) => {
    return db`
      INSERT INTO maintenance_requests (
        id, company_id, property_id, unit_id,
        title, description, priority, category, status,
        reported_by, assigned_to
      ) VALUES (
        ${id}, ${req.ctx.companyId}, ${data.propertyId}, ${data.unitId ?? null},
        ${data.title}, ${data.description ?? null}, ${data.priority}, ${data.category}, 'open',
        ${req.ctx.userId}, ${data.assignedTo ?? null}
      )
    `;
  });

  logger.info({ id, propertyId: data.propertyId, priority: data.priority }, 'Maintenance request created');
  res.status(201).json({ success: true, data: { id } } satisfies ApiResponse<unknown>);
});

// ─── PATCH /maintenance/:id ───────────────────────────────────────────────────

const UpdateSchema = z.object({
  status:          z.enum(STATUSES).optional(),
  priority:        z.enum(PRIORITIES).optional(),
  assignedTo:      z.string().uuid().optional().nullable(),
  resolutionNotes: z.string().optional().nullable(),
});

maintenanceRouter.patch('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const data   = UpdateSchema.parse(req.body);

  // Map 'acknowledged' → 'in_progress' for DB (enum doesn't have acknowledged)
  // acknowledged_at column captures when it was acknowledged separately
  const dbStatus = data.status === 'acknowledged' ? 'in_progress' : (data.status ?? null);

  const [updated] = await withRLS(ctx(req), async (db) => {
    return db`
      UPDATE maintenance_requests SET
        status           = COALESCE(${dbStatus}, status),
        priority         = COALESCE(${data.priority    ?? null}, priority),
        assigned_to      = COALESCE(${data.assignedTo  ?? null}, assigned_to),
        resolution_notes = COALESCE(${data.resolutionNotes ?? null}, resolution_notes),
        acknowledged_at  = CASE WHEN ${data.status ?? ''} = 'acknowledged' AND acknowledged_at IS NULL THEN NOW() ELSE acknowledged_at END,
        resolved_at      = CASE WHEN ${data.status ?? ''} IN ('resolved','closed') AND resolved_at IS NULL THEN NOW() ELSE resolved_at END,
        updated_at       = NOW()
      WHERE id = ${id} AND company_id = ${req.ctx.companyId}
      RETURNING id, status
    `;
  });

  if (!updated) throw new NotFoundError('Maintenance request not found');
  res.json({ success: true, data: { id, status: updated.status } } satisfies ApiResponse<unknown>);
});

// ─── DELETE /maintenance/:id ──────────────────────────────────────────────────

maintenanceRouter.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  await withRLS(ctx(req), async (db) => {
    return db`UPDATE maintenance_requests SET status = 'closed', updated_at = NOW() WHERE id = ${id}`;
  });
  res.json({ success: true, data: { message: 'Request closed' } } satisfies ApiResponse<unknown>);
});