// api/src/middleware/caretaker.ts
// Loads property scope + permissions for manager and caretaker roles

import { Request, Response, NextFunction } from 'express';
import { sql } from '../db';
import { ForbiddenError } from '../lib/errors';

export interface CaretakerPerms {
  propertyIds:    string[];
  canViewTenants: boolean;
  canViewLeases:  boolean;
  canViewBilling: boolean;
  canViewUnits:   boolean;
}

declare global {
  namespace Express {
    interface Request {
      caretakerPerms?:    CaretakerPerms;
      managerPropertyIds?: string[] | null; // null = see all
    }
  }
}

// Load property scope for manager + caretaker on every authenticated request
export async function loadCaretakerPerms(
  req: Request, _res: Response, next: NextFunction
): Promise<void> {
  const role = req.ctx.userRole;

  if (role === 'caretaker') {
    const [perms] = await sql`
      SELECT property_ids, can_view_tenants, can_view_leases, can_view_billing, can_view_units
      FROM caretaker_permissions
      WHERE user_id = ${req.ctx.userId}
    `;
    req.caretakerPerms = perms ? {
      propertyIds:    perms.property_ids ?? [],
      canViewTenants: perms.can_view_tenants,
      canViewLeases:  perms.can_view_leases,
      canViewBilling: perms.can_view_billing,
      canViewUnits:   perms.can_view_units,
    } : {
      propertyIds: [], canViewTenants: false, canViewLeases: false,
      canViewBilling: false, canViewUnits: false,
    };

  } else if (role === 'manager') {
    const [row] = await sql`
      SELECT property_ids FROM manager_property_assignments
      WHERE user_id = ${req.ctx.userId}
    `;
    // null = no assignment row = see all; empty array = assigned but nothing picked yet
    req.managerPropertyIds = row ? (row.property_ids ?? []) : null;
  }

  next();
}

// Returns the property ID filter for the current user:
// - owner/finance/super_admin: null (no filter, see all)
// - manager: their assigned property_ids, or null if unassigned (see all)
// - caretaker: their assigned property_ids (always filtered, even if empty)
export function getPropertyFilter(req: Request): string[] | null {
  const role = req.ctx.userRole;
  if (role === 'caretaker') return req.caretakerPerms?.propertyIds ?? [];
  if (role === 'manager') {
    // null means no assignment row = see all; [] means assigned but empty = see nothing
    return req.managerPropertyIds ?? null;
  }
  return null; // owner, finance, super_admin see all
}

// Whether the current user is scoped to specific properties
export function isPropertyScoped(req: Request): boolean {
  return getPropertyFilter(req) !== null;
}

// Guard: block caretakers from a module unless they have the permission
export function requireCaretakerPerm(perm: keyof Omit<CaretakerPerms, 'propertyIds'>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (req.ctx.userRole !== 'caretaker') { next(); return; }
    if (!req.caretakerPerms?.[perm]) {
      throw new ForbiddenError('Your account does not have permission to access this resource');
    }
    next();
  };
}

// Guard: block caretakers entirely from a module
export function blockCaretaker(req: Request, _res: Response, next: NextFunction): void {
  if (req.ctx.userRole === 'caretaker') {
    throw new ForbiddenError('Caretakers do not have access to this module');
  }
  next();
}