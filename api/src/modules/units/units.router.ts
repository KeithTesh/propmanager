// api/src/modules/units/units.router.ts

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { withRLS, withRLSTransaction } from '../../db';
import { authenticate } from '../../middleware/auth';
import { NotFoundError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { ApiResponse, RLSContext } from '../../types';

export const unitsRouter = Router();
unitsRouter.use(authenticate);

function ctx(req: Request): RLSContext {
  return { companyId: req.ctx.companyId!, userId: req.ctx.userId, userRole: req.ctx.userRole };
}

const UNIT_TYPES = ['bedsitter','studio','1br','2br','3br','4br','commercial','other'] as const;

const UnitSchema = z.object({
  propertyId:  z.string().uuid(),
  unitNumber:  z.string().min(1, 'Unit number required'),
  unitType:    z.enum(UNIT_TYPES).optional().nullable(),
  floorNumber: z.number().int().optional().nullable(),
  sizeSqm:     z.number().positive().optional().nullable(),
  bedrooms:    z.number().int().min(0).optional().nullable(),
  bathrooms:   z.number().int().min(0).optional().nullable(),
  isActive:    z.boolean().optional().default(true),
  notes:       z.string().optional().nullable(),
});

// ─── GET /units?propertyId=xxx ────────────────────────────────────────────────

unitsRouter.get('/', async (req: Request, res: Response) => {
  const { propertyId } = req.query;

  const units = await withRLS(ctx(req), async (db) => {
    if (propertyId) {
      return db`
        SELECT
          u.*,
          -- current active lease info
          l.id            AS lease_id,
          l.monthly_rent,
          l.status        AS lease_status,
          t.full_name     AS tenant_name,
          t.phone         AS tenant_phone
        FROM units u
        LEFT JOIN leases l ON l.unit_id = u.id AND l.status = 'active'
        LEFT JOIN tenants t ON t.id = l.primary_tenant_id
        WHERE u.property_id = ${propertyId as string}
          AND u.deleted_at IS NULL
        ORDER BY u.unit_number
      `;
    }
    const statusFilter = req.query.status;
    return db`
      SELECT u.*, p.name AS property_name
      FROM units u
      JOIN properties p ON p.id = u.property_id
      WHERE u.deleted_at IS NULL
        ${statusFilter === 'vacant'   ? db`AND u.is_occupied = false AND u.is_active = true` : db``}
        ${statusFilter === 'occupied' ? db`AND u.is_occupied = true` : db``}
      ORDER BY p.name, u.unit_number
    `;
  });

  res.json({ success: true, data: { units } } satisfies ApiResponse<unknown>);
});

// ─── GET /units/:id ───────────────────────────────────────────────────────────

unitsRouter.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  const [unit] = await withRLS(ctx(req), async (db) => {
    return db`
      SELECT
        u.*,
        p.name AS property_name,
        l.id           AS lease_id,
        l.monthly_rent,
        l.status       AS lease_status,
        l.start_date,
        l.end_date,
        t.id           AS tenant_id,
        t.full_name    AS tenant_name,
        t.phone        AS tenant_phone,
        t.email        AS tenant_email
      FROM units u
      JOIN properties p ON p.id = u.property_id
      LEFT JOIN leases l ON l.unit_id = u.id AND l.status = 'active'
      LEFT JOIN tenants t ON t.id = l.tenant_id
      WHERE u.id = ${id} AND u.deleted_at IS NULL
    `;
  });

  if (!unit) throw new NotFoundError('Unit not found');
  res.json({ success: true, data: { unit } } satisfies ApiResponse<unknown>);
});

// ─── POST /units ──────────────────────────────────────────────────────────────

unitsRouter.post('/', async (req: Request, res: Response) => {
  const data      = UnitSchema.parse(req.body);
  const id        = randomUUID();
  const companyId = req.ctx.companyId!;

  await withRLS(ctx(req), async (db) => {
    // Check unit limit before inserting
    const [company] = await db`
      SELECT unit_limit, units_used, name FROM companies WHERE id = ${companyId}
    `;
    if (company && company.units_used >= company.unit_limit) {
      res.status(403).json({
        success: false,
        error: {
          code: 'UNIT_LIMIT_REACHED',
          message: `You have reached your plan limit of ${company.unit_limit} units. Please upgrade your plan to add more units.`,
        },
      });
      return;
    }

    // Warn at 80% — return warning in response header
    const usagePercent = company ? Math.round((company.units_used / company.unit_limit) * 100) : 0;
    if (usagePercent >= 80) {
      res.setHeader('X-Unit-Limit-Warning', `${company.units_used}/${company.unit_limit} units used (${usagePercent}%)`);
    }

    await db`
      INSERT INTO units (
        id, property_id, company_id,
        unit_number, unit_type, floor_number,
        size_sqm, bedrooms, bathrooms,
        is_active, notes
      ) VALUES (
        ${id}, ${data.propertyId}, ${companyId},
        ${data.unitNumber}, ${data.unitType ?? null}, ${data.floorNumber ?? null},
        ${data.sizeSqm ?? null}, ${data.bedrooms ?? null}, ${data.bathrooms ?? null},
        ${data.isActive ?? true}, ${data.notes ?? null}
      )
    `;
  });

  // Update units_used count on company
  await withRLS(ctx(req), async (db) => {
    await db`
      UPDATE companies SET
        units_used = (SELECT COUNT(*) FROM units WHERE company_id = ${companyId} AND deleted_at IS NULL),
        updated_at = NOW()
      WHERE id = ${companyId}
    `;
  });

  logger.info({ unitId: id, propertyId: data.propertyId }, 'Unit created');
  res.status(201).json({ success: true, data: { unit: { id, unitNumber: data.unitNumber } } } satisfies ApiResponse<unknown>);
});

// ─── POST /units/bulk ─────────────────────────────────────────────────────────
// Create multiple units at once e.g. A1-A10

unitsRouter.post('/bulk', async (req: Request, res: Response) => {
  const BulkSchema = z.object({
    propertyId: z.string().uuid(),
    prefix:     z.string().optional().default(''),
    from:       z.number().int().min(1),
    to:         z.number().int().min(1),
    unitType:   z.enum(UNIT_TYPES).optional().nullable(),
    bedrooms:   z.number().int().min(0).optional().nullable(),
    bathrooms:  z.number().int().min(0).optional().nullable(),
  });

  const data      = BulkSchema.parse(req.body);
  const companyId = req.ctx.companyId!;

  if (data.to < data.from) {
    res.status(400).json({ success: false, error: { message: '"to" must be >= "from"' } });
    return;
  }
  if (data.to - data.from > 99) {
    res.status(400).json({ success: false, error: { message: 'Max 100 units per bulk create' } });
    return;
  }

  const units: {
    id: string; property_id: string; company_id: string; unit_number: string;
    unit_type: string | null; bedrooms: number | null; bathrooms: number | null;
  }[] = [];
  for (let i = data.from; i <= data.to; i++) {
    units.push({
      id:          randomUUID(),
      property_id: data.propertyId,
      company_id:  companyId,
      unit_number: `${data.prefix}${i}`,
      unit_type:   data.unitType ?? null,
      bedrooms:    data.bedrooms ?? null,
      bathrooms:   data.bathrooms ?? null,
    });
  }

  await withRLS(ctx(req), async (db) => {
    await db`
      INSERT INTO units ${db(units, 'id','property_id','company_id','unit_number','unit_type','bedrooms','bathrooms')}
      ON CONFLICT (property_id, unit_number) DO NOTHING
    `;
  });

  logger.info({ propertyId: data.propertyId, count: units.length }, 'Bulk units created');
  res.status(201).json({ success: true, data: { created: units.length } } satisfies ApiResponse<unknown>);
});

// ─── PATCH /units/:id ─────────────────────────────────────────────────────────

unitsRouter.patch('/:id', async (req: Request, res: Response) => {
  const { id }  = req.params;
  const data    = UnitSchema.omit({ propertyId: true }).partial().parse(req.body);

  const [updated] = await withRLS(ctx(req), async (db) => {
    return db`
      UPDATE units SET
        unit_number  = COALESCE(${data.unitNumber  ?? null}, unit_number),
        unit_type    = COALESCE(${data.unitType    ?? null}, unit_type),
        floor_number = COALESCE(${data.floorNumber ?? null}, floor_number),
        size_sqm     = COALESCE(${data.sizeSqm     ?? null}, size_sqm),
        bedrooms     = COALESCE(${data.bedrooms    ?? null}, bedrooms),
        bathrooms    = COALESCE(${data.bathrooms   ?? null}, bathrooms),
        is_active    = COALESCE(${data.isActive    ?? null}, is_active),
        notes        = COALESCE(${data.notes       ?? null}, notes),
        updated_at   = NOW()
      WHERE id = ${id} AND deleted_at IS NULL
      RETURNING id, unit_number
    `;
  });

  if (!updated) throw new NotFoundError('Unit not found');
  res.json({ success: true, data: { unit: updated } } satisfies ApiResponse<unknown>);
});

// ─── DELETE /units/:id ────────────────────────────────────────────────────────

unitsRouter.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  await withRLSTransaction(ctx(req), async (tx) => {
    const [active] = await tx`
      SELECT COUNT(*) AS count FROM leases
      WHERE unit_id = ${id} AND status = 'active'
    `;
    if (parseInt(active.count) > 0) {
      throw new Error('Cannot archive a unit with an active lease. Vacate the tenant first.');
    }
    await tx`
      UPDATE units SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = ${id} AND deleted_at IS NULL
    `;
  });

  logger.info({ unitId: id }, 'Unit archived');
  res.json({ success: true, data: { message: 'Unit archived' } } satisfies ApiResponse<unknown>);
});