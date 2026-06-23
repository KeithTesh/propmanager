// api/src/middleware/auth.ts
/**
 * Auth middleware
 *
 * 1. Validates JWT from Authorization: Bearer header
 * 2. Loads user from DB (confirms still active, not deleted)
 * 3. Attaches ctx (companyId, userId, userRole, user) to req
 * 4. All downstream handlers read req.ctx — never decode JWT themselves
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { sql } from '../db';
import { UnauthorizedError, ForbiddenError } from '../lib/errors';
import type { UserRole, User, RequestContext } from '../types';

interface JwtPayload {
  sub: string;        // user ID
  companyId: string;
  role: UserRole;
  iat: number;
  exp: number;
}

// ─── CORE AUTH MIDDLEWARE ────────────────────────────────────────────────────

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or malformed Authorization header');
  }

  const token = header.slice(7);
  let payload: JwtPayload;

  try {
    payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError('Token expired');
    }
    throw new UnauthorizedError('Invalid token');
  }

  // Load user from DB — ensures they haven't been deactivated since token issued
  const [user] = await sql<User[]>`
    SELECT
      id, company_id, role, email, phone, full_name, avatar_url,
      is_active, last_login_at, notify_sms, notify_email,
      created_at, updated_at, deleted_at
    FROM users
    WHERE id = ${payload.sub}
      AND deleted_at IS NULL
      AND is_active = TRUE
  `;

  if (!user) {
    throw new UnauthorizedError('User not found or inactive');
  }

  req.ctx = {
    // Use company_id from the freshly-loaded DB record, not the JWT payload.
    // JWT payload.companyId can be stale (e.g. user moved between companies).
    // The DB record is always authoritative for tenant isolation.
    companyId: (user as any).company_id ?? payload.companyId,
    userId: user.id,
    userRole: user.role,
    user,
  } satisfies RequestContext;

  next();
}

// ─── ROLE GUARDS ─────────────────────────────────────────────────────────────

/**
 * Require specific roles. Use after authenticate().
 * E.g. requireRole('owner', 'manager')
 */
export function requireRole(...roles: UserRole[]) {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    const userRole = _req.ctx.userRole;
    if (userRole === 'super_admin') {
      next(); // super_admin can always proceed
      return;
    }
    if (!roles.includes(userRole)) {
      throw new ForbiddenError(
        `This action requires one of the following roles: ${roles.join(', ')}`
      );
    }
    next();
  };
}

// Convenience guards for common patterns
export const requireOwner = requireRole('owner');
export const requireFinanceOrAbove = requireRole('owner', 'manager', 'finance');
export const requireManagerOrAbove = requireRole('owner', 'manager');
export const requireStaff = requireRole('owner', 'manager', 'finance', 'caretaker');

// ─── SETUP WIZARD GUARD ──────────────────────────────────────────────────────

/**
 * Block API calls that require a completed setup if company setup is incomplete.
 * Allows through: auth routes, setup routes, health check.
 * SIM-N3: setup wizard blocks access to core features
 */
export async function requireSetupComplete(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  // super_admin has no company — always allow
  if (req.ctx.user.role === 'super_admin') {
    next();
    return;
  }

  // These paths are accessible before setup completes
  // Note: req.path has /api/v1 prefix stripped by Express router
  const allowedPaths = [
    '/auth',
    '/companies/setup',
    '/health',
    '/me',
  ];

  if (allowedPaths.some(p => req.path.startsWith(p))) {
    next();
    return;
  }

  const [company] = await sql`
    SELECT setup_completed FROM companies WHERE id = ${req.ctx.companyId}
  `;

  if (!company?.setup_completed) {
    throw new ForbiddenError(
      'Company setup is not complete. Please finish the setup wizard before using this feature.'
    );
  }

  next();
}