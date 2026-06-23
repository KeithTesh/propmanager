// api/src/modules/properties/properties.router.ts

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { withRLS } from '../../db';
import { authenticate } from '../../middleware/auth';
import { NotFoundError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { ApiResponse, RLSContext } from '../../types';

export const propertiesRouter = Router();
propertiesRouter.use(authenticate);

function ctx(req: Request): RLSContext {
  return { companyId: req.ctx.companyId!, userId: req.ctx.userId, userRole: req.ctx.userRole };
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const PropertySchema = z.object({
  name:                  z.string().min(2, 'Property name required'),
  address:               z.string().optional().nullable(),
  county:                z.string().optional().nullable(),
  description:           z.string().optional().nullable(),
  totalUnits:            z.number().int().min(1).optional().nullable(),
  isActive:              z.boolean().optional().default(true),
  paymentMethodOverride: z.enum(['bank_paybill','daraja_stk','cash','manual']).optional().nullable(),
  paybillOverride:       z.string().optional().nullable(),
  tillOverride:          z.string().optional().nullable(),
  landlordId:            z.string().uuid().optional().nullable(),
});

// ─── GET /properties ──────────────────────────────────────────────────────────

propertiesRouter.get('/', async (req: Request, res: Response) => {
  const companyId = req.ctx.companyId!;

  const properties = await withRLS(ctx(req), async (db) => {
    return db`
      SELECT
        p.id, p.name, p.address, p.county, p.description,
        p.total_units, p.is_active,
        p.payment_method_override, p.paybill_override, p.till_override,
        p.created_at, p.updated_at,
        p.landlord_id, l.full_name AS landlord_name,
        COUNT(u.id)                                         AS unit_count,
        COUNT(u.id) FILTER (WHERE u.is_occupied = TRUE)     AS occupied_count,
        COUNT(u.id) FILTER (WHERE u.is_occupied = FALSE
          AND u.is_active = TRUE AND u.deleted_at IS NULL)  AS vacant_count
      FROM properties p
      LEFT JOIN landlords l ON l.id = p.landlord_id
                            AND l.company_id = ${companyId}
                            AND l.deleted_at IS NULL
      LEFT JOIN units u ON u.property_id = p.id
                        AND u.company_id  = ${companyId}
                        AND u.deleted_at  IS NULL
      WHERE p.company_id  = ${companyId}
        AND p.deleted_at IS NULL
      GROUP BY p.id, l.id, l.full_name
      ORDER BY p.created_at DESC
    `;
  });

  res.json({ success: true, data: { properties } } satisfies ApiResponse<unknown>);
});

// ─── GET /properties/:id ──────────────────────────────────────────────────────

propertiesRouter.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const companyId = req.ctx.companyId!;

  const result = await withRLS(ctx(req), async (db) => {
    return db`
      SELECT
        p.*,
        l.full_name AS landlord_name,
        COUNT(u.id)                                         AS unit_count,
        COUNT(u.id) FILTER (WHERE u.is_occupied = TRUE)     AS occupied_count,
        COUNT(u.id) FILTER (WHERE u.is_occupied = FALSE
          AND u.is_active = TRUE AND u.deleted_at IS NULL)  AS vacant_count
      FROM properties p
      LEFT JOIN landlords l ON l.id = p.landlord_id
                            AND l.company_id = ${companyId}
                            AND l.deleted_at IS NULL
      LEFT JOIN units u ON u.property_id = p.id
                        AND u.company_id  = ${companyId}
                        AND u.deleted_at  IS NULL
      WHERE p.id         = ${id}
        AND p.company_id = ${companyId}
        AND p.deleted_at IS NULL
      GROUP BY p.id, l.id, l.full_name
    `;
  });

  if (!result[0]) throw new NotFoundError('Property not found');

  res.json({ success: true, data: { property: result[0] } } satisfies ApiResponse<unknown>);
});

// ─── POST /properties ─────────────────────────────────────────────────────────

propertiesRouter.post('/', async (req: Request, res: Response) => {
  const data      = PropertySchema.parse(req.body);
  const id        = randomUUID();
  const companyId = req.ctx.companyId!;

  await withRLS(ctx(req), async (db) => {
    // Ensure the specified landlord belongs to this company
    if (data.landlordId) {
      const [landlord] = await db`
        SELECT id FROM landlords
        WHERE id = ${data.landlordId}
          AND company_id = ${companyId}
          AND deleted_at IS NULL
      `;
      if (!landlord) throw new NotFoundError('Landlord not found');
    }

    await db`
      INSERT INTO properties (
        id, company_id, name, address, county, description,
        total_units, is_active,
        payment_method_override, paybill_override, till_override,
        landlord_id
      ) VALUES (
        ${id}, ${companyId}, ${data.name},
        ${data.address ?? null}, ${data.county ?? null},
        ${data.description ?? null}, ${data.totalUnits ?? null},
        ${data.isActive ?? true},
        ${data.paymentMethodOverride ?? null},
        ${data.paybillOverride ?? null},
        ${data.tillOverride ?? null},
        ${data.landlordId ?? null}
      )
    `;
  });

  logger.info({ propertyId: id, companyId }, 'Property created');

  res.status(201).json({
    success: true,
    data: { property: { id, name: data.name } },
  } satisfies ApiResponse<unknown>);
});

// ─── PATCH /properties/:id ────────────────────────────────────────────────────

propertiesRouter.patch('/:id', async (req: Request, res: Response) => {
  const { id }    = req.params;
  const data      = PropertySchema.partial().parse(req.body);
  const companyId = req.ctx.companyId!;

  const updated = await withRLS(ctx(req), async (db) => {
    // Ensure the specified landlord belongs to this company
    if (data.landlordId) {
      const [landlord] = await db`
        SELECT id FROM landlords
        WHERE id = ${data.landlordId}
          AND company_id = ${companyId}
          AND deleted_at IS NULL
      `;
      if (!landlord) throw new NotFoundError('Landlord not found');
    }

    const [row] = await db`
      UPDATE properties SET
        name                   = COALESCE(${data.name ?? null}, name),
        address                = COALESCE(${data.address ?? null}, address),
        county                 = COALESCE(${data.county ?? null}, county),
        description            = COALESCE(${data.description ?? null}, description),
        total_units            = COALESCE(${data.totalUnits ?? null}, total_units),
        landlord_id            = COALESCE(${data.landlordId ?? null}, landlord_id),
        is_active              = COALESCE(${data.isActive ?? null}, is_active),
        payment_method_override= COALESCE(${data.paymentMethodOverride ?? null}, payment_method_override),
        paybill_override       = COALESCE(${data.paybillOverride ?? null}, paybill_override),
        till_override          = COALESCE(${data.tillOverride ?? null}, till_override),
        updated_at             = NOW()
      WHERE id         = ${id}
        AND company_id = ${companyId}
        AND deleted_at IS NULL
      RETURNING id, name
    `;
    return row;
  });

  if (!updated) throw new NotFoundError('Property not found');

  res.json({ success: true, data: { property: updated } } satisfies ApiResponse<unknown>);
});

// ─── DELETE /properties/:id ───────────────────────────────────────────────────

propertiesRouter.delete('/:id', async (req: Request, res: Response) => {
  const { id }    = req.params;
  const companyId = req.ctx.companyId!;

  await withRLS(ctx(req), async (db) => {
    return db.begin(async (sql: any) => {
      // Verify property belongs to this company before doing anything
      const [property] = await sql`
        SELECT id FROM properties
        WHERE id = ${id} AND company_id = ${companyId} AND deleted_at IS NULL
      `;
      if (!property) throw new NotFoundError('Property not found');

      // Check no active leases on units under this property, scoped to company
      const [activeLeases] = await sql`
        SELECT COUNT(*) AS count
        FROM leases l
        JOIN units u ON u.id = l.unit_id AND u.company_id = ${companyId}
        WHERE u.property_id = ${id}
          AND l.company_id  = ${companyId}
          AND l.status      = 'active'
      `;

      if (parseInt(activeLeases.count) > 0) {
        throw new Error('Cannot delete property with active leases. Vacate all units first.');
      }

      await sql`
        UPDATE properties SET deleted_at = NOW(), updated_at = NOW()
        WHERE id         = ${id}
          AND company_id = ${companyId}
          AND deleted_at IS NULL
      `;
    });
  });

  logger.info({ propertyId: id, companyId }, 'Property deleted');

  res.json({ success: true, data: { message: 'Property deleted' } } satisfies ApiResponse<unknown>);
});
