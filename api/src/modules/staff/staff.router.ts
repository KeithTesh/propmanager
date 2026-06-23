// api/src/modules/staff/staff.router.ts
// Staff management — owner only (create, list, deactivate, manage caretaker permissions)

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { sql } from '../../db';
import { requireRole } from '../../middleware/auth';
import { NotFoundError, ValidationError, ForbiddenError } from '../../lib/errors';

export const staffRouter = Router();

const requireOwnerOrManager = requireRole('owner', 'manager');
const requireOwner          = requireRole('owner');

// ─── GET /staff ───────────────────────────────────────────────────────────────
// List all staff (non-tenant, non-super_admin) in this company

staffRouter.get('/', requireOwnerOrManager, async (req: Request, res: Response) => {
  const { companyId } = req.ctx;

  const staff = await sql`
    SELECT
      u.id, u.full_name, u.email, u.phone, u.role,
      u.is_active, u.last_login_at, u.created_at,
      -- caretaker permissions (null if not caretaker)
      cp.property_ids        AS caretaker_property_ids,
      cp.can_view_tenants,
      cp.can_view_leases,
      cp.can_view_billing,
      cp.can_view_units,
      ma.property_ids        AS manager_property_ids
    FROM users u
    LEFT JOIN caretaker_permissions cp ON cp.user_id = u.id
    LEFT JOIN manager_property_assignments ma ON ma.user_id = u.id
    WHERE u.company_id = ${companyId}
      AND u.role IN ('owner', 'manager', 'finance', 'caretaker')
      AND u.deleted_at IS NULL
    ORDER BY
      CASE u.role
        WHEN 'owner'     THEN 1
        WHEN 'manager'   THEN 2
        WHEN 'finance'   THEN 3
        WHEN 'caretaker' THEN 4
      END,
      u.full_name
  `;

  res.json({ success: true, data: { staff } });
});

// ─── POST /staff ──────────────────────────────────────────────────────────────
// Create a new staff member (owner only)

staffRouter.post('/', requireOwner, async (req: Request, res: Response) => {
  const { companyId } = req.ctx;

  const body = z.object({
    fullName:  z.string().min(2),
    email:     z.string().email(),
    phone:     z.string().optional(),
    role:      z.enum(['manager', 'finance', 'caretaker']),
    // caretaker-specific
    propertyIds:     z.array(z.string().uuid()).optional(),
    canViewTenants:  z.boolean().optional(),
    canViewLeases:   z.boolean().optional(),
    canViewBilling:  z.boolean().optional(),
    canViewUnits:    z.boolean().optional(),
  }).parse(req.body);

  // Check email not already taken
  const [existing] = await sql`
    SELECT id FROM users WHERE email = lower(${body.email}) AND deleted_at IS NULL
  `;
  if (existing) throw new ValidationError('A user with this email already exists');

  // Generate temp password
  const adjectives = ['Blue','Gold','Teal','Jade','Ruby','Sage','Rose','Dawn','Lime','Aqua'];
  const nouns      = ['Gate','Home','Keys','Roof','Yard','Park','View','Nest','Door','Path'];
  const adj  = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num  = String(Math.floor(Math.random() * 9000) + 1000);
  const tempPassword = `${adj}${noun}${num}`;
  const hash = await bcrypt.hash(tempPassword, 12);

  const [user] = await sql`
    INSERT INTO users (company_id, role, email, phone, full_name, password_hash)
    VALUES (${companyId}, ${body.role}, lower(${body.email}), ${body.phone ?? null}, ${body.fullName}, ${hash})
    RETURNING id, full_name, email, phone, role, is_active, created_at
  `;

  // If manager, save property assignments
  if (body.role === 'manager' && body.propertyIds && body.propertyIds.length > 0) {
    await sql`
      INSERT INTO manager_property_assignments (user_id, company_id, property_ids)
      VALUES (${user.id}, ${companyId}, ${body.propertyIds})
      ON CONFLICT (user_id) DO UPDATE SET
        property_ids = ${body.propertyIds},
        updated_at   = NOW()
    `;
  }

  // If caretaker, create permissions row
  if (body.role === 'caretaker') {
    await sql`
      INSERT INTO caretaker_permissions (
        user_id, company_id, property_ids,
        can_view_tenants, can_view_leases, can_view_billing, can_view_units
      ) VALUES (
        ${user.id}, ${companyId},
        ${body.propertyIds ?? []},
        ${body.canViewTenants ?? false},
        ${body.canViewLeases  ?? false},
        ${body.canViewBilling ?? false},
        ${body.canViewUnits   ?? true}
      )
    `;
  }

  res.json({ success: true, data: { user, tempPassword } });
});

// ─── PATCH /staff/:id ─────────────────────────────────────────────────────────
// Update staff member details or caretaker permissions (owner only)

staffRouter.patch('/:id', requireOwner, async (req: Request, res: Response) => {
  const { companyId } = req.ctx;
  const { id } = req.params;

  const body = z.object({
    fullName:        z.string().min(2).optional(),
    phone:           z.string().nullable().optional(),
    isActive:        z.boolean().optional(),
    // caretaker permissions
    propertyIds:     z.array(z.string().uuid()).optional(),
    canViewTenants:  z.boolean().optional(),
    canViewLeases:   z.boolean().optional(),
    canViewBilling:  z.boolean().optional(),
    canViewUnits:    z.boolean().optional(),
  }).parse(req.body);

  const [user] = await sql`
    SELECT id, role FROM users
    WHERE id = ${id} AND company_id = ${companyId} AND deleted_at IS NULL
  `;
  if (!user) throw new NotFoundError('Staff member not found');

  // Update user fields if provided
  if (body.fullName !== undefined || body.phone !== undefined || body.isActive !== undefined) {
    await sql`
      UPDATE users SET
        full_name  = COALESCE(${body.fullName  ?? null}, full_name),
        phone      = COALESCE(${body.phone     ?? null}, phone),
        is_active  = COALESCE(${body.isActive  ?? null}, is_active),
        updated_at = NOW()
      WHERE id = ${id}
    `;
  }

  // Update manager property assignments
  if (user.role === 'manager' && body.propertyIds !== undefined) {
    await sql`
      INSERT INTO manager_property_assignments (user_id, company_id, property_ids)
      VALUES (${id}, ${companyId}, ${body.propertyIds})
      ON CONFLICT (user_id) DO UPDATE SET
        property_ids = ${body.propertyIds},
        updated_at   = NOW()
    `;
  }

  // Update caretaker permissions if applicable
  if (user.role === 'caretaker') {
    const hasPermUpdates = [
      body.propertyIds, body.canViewTenants, body.canViewLeases,
      body.canViewBilling, body.canViewUnits
    ].some(v => v !== undefined);

    if (hasPermUpdates) {
      await sql`
        INSERT INTO caretaker_permissions (user_id, company_id, property_ids, can_view_tenants, can_view_leases, can_view_billing, can_view_units)
        VALUES (${id}, ${companyId},
          ${body.propertyIds     ?? []},
          ${body.canViewTenants  ?? false},
          ${body.canViewLeases   ?? false},
          ${body.canViewBilling  ?? false},
          ${body.canViewUnits    ?? true})
        ON CONFLICT (user_id) DO UPDATE SET
          property_ids     = COALESCE(${body.propertyIds    ?? null}, caretaker_permissions.property_ids),
          can_view_tenants = COALESCE(${body.canViewTenants ?? null}, caretaker_permissions.can_view_tenants),
          can_view_leases  = COALESCE(${body.canViewLeases  ?? null}, caretaker_permissions.can_view_leases),
          can_view_billing = COALESCE(${body.canViewBilling ?? null}, caretaker_permissions.can_view_billing),
          can_view_units   = COALESCE(${body.canViewUnits   ?? null}, caretaker_permissions.can_view_units),
          updated_at       = NOW()
      `;
    }
  }

  res.json({ success: true, data: { message: 'Staff member updated' } });
});

// ─── DELETE /staff/:id ────────────────────────────────────────────────────────
// Deactivate (soft delete) a staff member (owner only)

staffRouter.delete('/:id', requireOwner, async (req: Request, res: Response) => {
  const { companyId, userId } = req.ctx;
  const { id } = req.params;

  if (id === userId) throw new ValidationError('You cannot deactivate your own account');

  const [user] = await sql`
    SELECT id, role FROM users
    WHERE id = ${id} AND company_id = ${companyId} AND deleted_at IS NULL
  `;
  if (!user) throw new NotFoundError('Staff member not found');
  if (user.role === 'owner') throw new ValidationError('Cannot deactivate the owner account');

  await sql`
    UPDATE users SET is_active = FALSE, updated_at = NOW()
    WHERE id = ${id}
  `;

  res.json({ success: true, data: { message: 'Staff member deactivated' } });
});

// ─── POST /staff/:id/reset-password ──────────────────────────────────────────
// Reset a staff member's password (owner only)

staffRouter.post('/:id/reset-password', requireOwnerOrManager, async (req: Request, res: Response) => {
  const { companyId } = req.ctx;
  const { id } = req.params;

  const [user] = await sql`
    SELECT id, email, role FROM users
    WHERE id = ${id} AND company_id = ${companyId} AND deleted_at IS NULL
  `;
  if (!user) throw new NotFoundError('Staff member not found');
  // Managers cannot reset owner passwords
  if (req.ctx.userRole === 'manager' && user.role === 'owner') {
    throw new ForbiddenError('Managers cannot reset the owner password');
  }

  const adjectives = ['Blue','Gold','Teal','Jade','Ruby','Sage','Rose','Dawn','Lime','Aqua'];
  const nouns      = ['Gate','Home','Keys','Roof','Yard','Park','View','Nest','Door','Path'];
  const adj  = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num  = String(Math.floor(Math.random() * 9000) + 1000);
  const tempPassword = `${adj}${noun}${num}`;
  const hash = await bcrypt.hash(tempPassword, 12);

  await sql`UPDATE users SET password_hash = ${hash}, updated_at = NOW() WHERE id = ${id}`;

  res.json({ success: true, data: { email: user.email, tempPassword } });
});