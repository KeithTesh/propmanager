// api/src/modules/units/units.router.ts

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { withRLS, withRLSTransaction } from '../../db';
import { authenticate } from '../../middleware/auth';
import { AppError, NotFoundError } from '../../lib/errors';
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
  const limit = z.coerce.number().int().min(1).max(100).optional().parse(req.query.limit);
  const companyId = req.ctx.companyId!;

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
          t.phone         AS tenant_phone,
          p.name          AS property_name,
          p.landlord_id,
          landlord.full_name AS landlord_name
        FROM units u
        JOIN properties p ON p.id = u.property_id AND p.company_id = ${companyId}
        LEFT JOIN landlords landlord ON landlord.id = p.landlord_id
          AND landlord.company_id = ${companyId} AND landlord.deleted_at IS NULL
        LEFT JOIN leases l ON l.unit_id = u.id AND l.company_id = ${companyId} AND l.status = 'active'
        LEFT JOIN tenants t ON t.id = l.primary_tenant_id AND t.company_id = ${companyId}
        WHERE u.property_id = ${propertyId as string}
          AND u.company_id = ${companyId}
          AND u.deleted_at IS NULL
        ORDER BY u.unit_number
      `;
    }
    const statusFilter = req.query.status;
    return db`
      SELECT
        u.*,
        p.name AS property_name,
        p.landlord_id,
        landlord.full_name AS landlord_name,
        l.id AS lease_id,
        l.monthly_rent,
        l.status AS lease_status,
        t.full_name AS tenant_name,
        t.phone AS tenant_phone
      FROM units u
      JOIN properties p ON p.id = u.property_id AND p.company_id = ${companyId}
      LEFT JOIN landlords landlord ON landlord.id = p.landlord_id
        AND landlord.company_id = ${companyId} AND landlord.deleted_at IS NULL
      LEFT JOIN leases l ON l.unit_id = u.id AND l.company_id = ${companyId} AND l.status = 'active'
      LEFT JOIN tenants t ON t.id = l.primary_tenant_id AND t.company_id = ${companyId}
      WHERE u.company_id = ${companyId}
        AND u.deleted_at IS NULL
        ${statusFilter === 'vacant'   ? db`AND u.is_occupied = false AND u.is_active = true` : db``}
        ${statusFilter === 'occupied' ? db`AND u.is_occupied = true` : db``}
      ${limit ? db`ORDER BY u.created_at DESC LIMIT ${limit}` : db`ORDER BY p.name, u.unit_number`}
    `;
  });

  res.json({ success: true, data: { units } } satisfies ApiResponse<unknown>);
});

// ─── GET /units/:id ───────────────────────────────────────────────────────────

unitsRouter.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const companyId = req.ctx.companyId!;

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
      JOIN properties p ON p.id = u.property_id AND p.company_id = ${companyId}
      LEFT JOIN leases l ON l.unit_id = u.id AND l.company_id = ${companyId} AND l.status = 'active'
      LEFT JOIN tenants t ON t.id = l.tenant_id AND t.company_id = ${companyId}
      WHERE u.id = ${id}
        AND u.company_id = ${companyId}
        AND u.deleted_at IS NULL
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

  await withRLSTransaction(ctx(req), async (tx) => {
    const [company] = await tx`
      SELECT unit_limit FROM companies WHERE id = ${companyId} FOR UPDATE
    `;
    if (!company) throw new NotFoundError('Company not found');

    const [property] = await tx`
      SELECT total_units FROM properties
      WHERE id = ${data.propertyId} AND company_id = ${companyId} AND deleted_at IS NULL
      FOR UPDATE
    `;
    if (!property) throw new NotFoundError('Property not found');

    const [{ unit_count: propertyUnitCount }] = await tx`
      SELECT COUNT(*)::int AS unit_count FROM units
      WHERE property_id = ${data.propertyId} AND company_id = ${companyId} AND deleted_at IS NULL
    `;
    if (property.total_units !== null && propertyUnitCount >= property.total_units) {
      throw new AppError(422, 'PROPERTY_UNIT_LIMIT_REACHED',
        `This property is at its unit limit of ${property.total_units}. Increase the property's unit count to add more.`);
    }

    const [{ unit_count: companyUnitCount }] = await tx`
      SELECT COUNT(*)::int AS unit_count FROM units
      WHERE company_id = ${companyId} AND deleted_at IS NULL
    `;
    if (companyUnitCount >= company.unit_limit) {
      throw new AppError(403, 'UNIT_LIMIT_REACHED',
        `You have reached your plan limit of ${company.unit_limit} units. Please upgrade your plan to add more units.`);
    }

    const nextUsagePercent = Math.round((companyUnitCount / company.unit_limit) * 100);
    if (nextUsagePercent >= 80) {
      res.setHeader('X-Unit-Limit-Warning', `${companyUnitCount}/${company.unit_limit} units used (${nextUsagePercent}%)`);
    }

    await tx`
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
    await tx`
      UPDATE companies SET units_used = ${companyUnitCount + 1}, updated_at = NOW()
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

  const created = await withRLSTransaction(ctx(req), async (tx) => {
    const [company] = await tx`
      SELECT unit_limit FROM companies WHERE id = ${companyId} FOR UPDATE
    `;
    if (!company) throw new NotFoundError('Company not found');

    const [property] = await tx`
      SELECT total_units FROM properties
      WHERE id = ${data.propertyId} AND company_id = ${companyId} AND deleted_at IS NULL
      FOR UPDATE
    `;
    if (!property) throw new NotFoundError('Property not found');

    const unitNumbers = units.map(unit => unit.unit_number);
    const existing = await tx`
      SELECT unit_number FROM units
      WHERE property_id = ${data.propertyId}
        AND company_id = ${companyId}
        AND deleted_at IS NULL
        AND unit_number = ANY(${unitNumbers})
    `;
    const existingNumbers = new Set(existing.map(unit => unit.unit_number));
    const missingUnits = units.filter(unit => !existingNumbers.has(unit.unit_number));
    if (missingUnits.length === 0) return 0;

    const [{ unit_count: propertyUnitCount }] = await tx`
      SELECT COUNT(*)::int AS unit_count FROM units
      WHERE property_id = ${data.propertyId} AND company_id = ${companyId} AND deleted_at IS NULL
    `;
    if (property.total_units !== null && propertyUnitCount + missingUnits.length > property.total_units) {
      throw new AppError(422, 'PROPERTY_UNIT_LIMIT_REACHED',
        `This request exceeds the property's unit limit of ${property.total_units}. Only ${Math.max(property.total_units - propertyUnitCount, 0)} more units can be added.`);
    }

    const [{ unit_count: companyUnitCount }] = await tx`
      SELECT COUNT(*)::int AS unit_count FROM units
      WHERE company_id = ${companyId} AND deleted_at IS NULL
    `;
    if (companyUnitCount + missingUnits.length > company.unit_limit) {
      throw new AppError(403, 'UNIT_LIMIT_REACHED',
        `This request exceeds your plan limit of ${company.unit_limit} units. Please upgrade your plan to add more.`);
    }

    const nextUsagePercent = Math.round((companyUnitCount / company.unit_limit) * 100);
    if (nextUsagePercent >= 80) {
      res.setHeader('X-Unit-Limit-Warning', `${companyUnitCount}/${company.unit_limit} units used (${nextUsagePercent}%)`);
    }

    await tx`
      INSERT INTO units ${tx(missingUnits, 'id','property_id','company_id','unit_number','unit_type','bedrooms','bathrooms')}
    `;
    await tx`
      UPDATE companies SET units_used = ${companyUnitCount + missingUnits.length}, updated_at = NOW()
      WHERE id = ${companyId}
    `;
    return missingUnits.length;
  });

  logger.info({ propertyId: data.propertyId, count: created }, 'Bulk units created');
  res.status(201).json({ success: true, data: { created } } satisfies ApiResponse<unknown>);
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
  const companyId = req.ctx.companyId!;

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
      WHERE id = ${id} AND company_id = ${companyId} AND deleted_at IS NULL
    `;
    await tx`
      UPDATE companies SET
        units_used = (SELECT COUNT(*) FROM units WHERE company_id = ${companyId} AND deleted_at IS NULL),
        updated_at = NOW()
      WHERE id = ${companyId}
    `;
  });

  logger.info({ unitId: id }, 'Unit archived');
  res.json({ success: true, data: { message: 'Unit archived' } } satisfies ApiResponse<unknown>);
});