// api/src/modules/auth/auth.service.ts

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { sql } from '../../db';
import { getRedis } from '../../db/redis';
import { UnauthorizedError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { UserRole } from '../../types';

// ─── TYPES ───────────────────────────────────────────────────────────────────

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthUser {
  id: string;
  companyId: string | null;
  role: UserRole;
  email: string;
  fullName: string;
  phone: string | null;
  avatarUrl: string | null;
}

export interface AuthCompany {
  accountType: string;
  id: string;
  name: string;
  tradingName: string | null;
  logoUrl: string | null;
  setupCompleted: boolean;
  setupCurrentStep: number;
  paymentMethod: string;
}

// ─── TOKEN HELPERS ────────────────────────────────────────────────────────────

const ACCESS_TOKEN_TTL  = process.env.JWT_EXPIRES_IN         ?? '15m';
const REFRESH_TOKEN_TTL = process.env.JWT_REFRESH_EXPIRES_IN ?? '7d';
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days in seconds

function generateAccessToken(user: AuthUser): string {
  return jwt.sign(
    {
      sub:       user.id,
      companyId: user.companyId,
      role:      user.role,
    },
    process.env.JWT_SECRET!,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

function generateRefreshToken(userId: string): string {
  return jwt.sign(
    { sub: userId, jti: randomUUID() },
    process.env.JWT_REFRESH_SECRET!,
    { expiresIn: REFRESH_TOKEN_TTL }
  );
}

/**
 * Store refresh token in Redis with TTL.
 * Key: refresh:<userId>:<jti>
 * Value: '1'
 * Used to validate and revoke refresh tokens.
 */
async function storeRefreshToken(userId: string, token: string): Promise<void> {
  const payload = jwt.decode(token) as { jti: string };
  const redis = getRedis();
  await redis.set(
    `refresh:${userId}:${payload.jti}`,
    '1',
    'EX', REFRESH_TOKEN_TTL_SECONDS
  );
}

async function revokeRefreshToken(token: string): Promise<void> {
  try {
    const payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as { sub: string; jti: string };
    const redis = getRedis();
    await redis.del(`refresh:${payload.sub}:${payload.jti}`);
  } catch {
    // Token already invalid — ignore
  }
}

async function isRefreshTokenValid(token: string): Promise<{ userId: string } | null> {
  try {
    const payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as { sub: string; jti: string };
    const redis = getRedis();
    const exists = await redis.get(`refresh:${payload.sub}:${payload.jti}`);
    if (!exists) return null;
    return { userId: payload.sub };
  } catch {
    return null;
  }
}

// ─── AUTH SERVICE ─────────────────────────────────────────────────────────────

/**
 * Login with email + password.
 * Returns user, company (if any), and token pair.
 */
export async function login(email: string, password: string): Promise<{
  user: AuthUser;
  company: AuthCompany | null;
  tokens: TokenPair;
}> {
  // 1. Find user by email
  const [dbUser] = await sql`
    SELECT
      id, company_id, role, email, password_hash,
      full_name, phone, avatar_url, is_active, deleted_at
    FROM users
    WHERE email = lower(${email})
      AND deleted_at IS NULL
    LIMIT 1
  `;

  if (!dbUser) {
    // Timing-safe: still run bcrypt even if user not found
    await bcrypt.compare(password, '$2b$12$invalidhashfortimingsafety000000000000000000000');
    throw new UnauthorizedError('Invalid email or password');
  }

  if (!dbUser.is_active) {
    throw new UnauthorizedError('Your account has been deactivated. Contact your administrator.');
  }

  if (!dbUser.password_hash) {
    throw new UnauthorizedError('This account uses Google sign-in. Please sign in with Google.');
  }

  // 2. Verify password
  const valid = await bcrypt.compare(password, dbUser.password_hash);
  if (!valid) {
    throw new UnauthorizedError('Invalid email or password');
  }

  // 3. Update last_login_at
  await sql`
    UPDATE users SET last_login_at = NOW() WHERE id = ${dbUser.id}
  `;

  // 4. Load company if user belongs to one
  let company: AuthCompany | null = null;
  if (dbUser.company_id) {
    const [dbCompany] = await sql`
      SELECT
        id, name, trading_name, logo_url,
        setup_completed, setup_current_step, payment_method, account_type
      FROM companies
      WHERE id = ${dbUser.company_id}
        AND deleted_at IS NULL
    `;
    if (dbCompany) {
      company = {
        id:               dbCompany.id,
        name:             dbCompany.name,
        tradingName:      dbCompany.trading_name,
        logoUrl:          dbCompany.logo_url,
        setupCompleted:   dbCompany.setup_completed,
        setupCurrentStep: dbCompany.setup_current_step,
        paymentMethod:    dbCompany.payment_method,
        accountType:      dbCompany.account_type ?? 'landlord',
      };
    }
  }

  const user: AuthUser = {
    id:        dbUser.id,
    companyId: dbUser.company_id,
    role:      dbUser.role,
    email:     dbUser.email,
    fullName:  dbUser.full_name,
    phone:     dbUser.phone,
    avatarUrl: dbUser.avatar_url,
  };

  // 5. Generate tokens
  const accessToken  = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user.id);
  await storeRefreshToken(user.id, refreshToken);

  logger.info({ userId: user.id, role: user.role }, 'User logged in');

  return {
    user,
    company,
    tokens: {
      accessToken,
      refreshToken,
      expiresIn: 15 * 60, // 15 minutes in seconds
    },
  };
}

/**
 * Refresh access token using a valid refresh token.
 */
export async function refresh(refreshToken: string): Promise<{
  user: AuthUser;
  company: AuthCompany | null;
  tokens: TokenPair;
}> {
  const result = await isRefreshTokenValid(refreshToken);
  if (!result) {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  // Load fresh user data
  const [dbUser] = await sql`
    SELECT id, company_id, role, email, full_name, phone, avatar_url, is_active
    FROM users
    WHERE id = ${result.userId}
      AND deleted_at IS NULL
      AND is_active = TRUE
  `;

  if (!dbUser) {
    throw new UnauthorizedError('User not found or inactive');
  }

  // Rotate refresh token — revoke old, issue new
  await revokeRefreshToken(refreshToken);

  let company: AuthCompany | null = null;
  if (dbUser.company_id) {
    const [dbCompany] = await sql`
      SELECT id, name, trading_name, logo_url,
             setup_completed, setup_current_step, payment_method, account_type
      FROM companies
      WHERE id = ${dbUser.company_id} AND deleted_at IS NULL
    `;
    if (dbCompany) {
      company = {
        id:               dbCompany.id,
        name:             dbCompany.name,
        tradingName:      dbCompany.trading_name,
        logoUrl:          dbCompany.logo_url,
        setupCompleted:   dbCompany.setup_completed,
        setupCurrentStep: dbCompany.setup_current_step,
        paymentMethod:    dbCompany.payment_method,
        accountType:      dbCompany.account_type ?? 'landlord',
      };
    }
  }

  const user: AuthUser = {
    id:        dbUser.id,
    companyId: dbUser.company_id,
    role:      dbUser.role,
    email:     dbUser.email,
    fullName:  dbUser.full_name,
    phone:     dbUser.phone,
    avatarUrl: dbUser.avatar_url,
  };

  const newAccessToken  = generateAccessToken(user);
  const newRefreshToken = generateRefreshToken(user.id);
  await storeRefreshToken(user.id, newRefreshToken);

  return {
    user,
    company,
    tokens: {
      accessToken:  newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: 15 * 60,
    },
  };
}

/**
 * Logout — revoke the refresh token.
 */
export async function logout(refreshToken: string): Promise<void> {
  await revokeRefreshToken(refreshToken);
}

/**
 * Change password.
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const [user] = await sql`
    SELECT id, password_hash FROM users WHERE id = ${userId}
  `;

  if (!user?.password_hash) {
    throw new UnauthorizedError('Cannot change password for this account type');
  }

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) {
    throw new UnauthorizedError('Current password is incorrect');
  }

  if (newPassword.length < 8) {
    throw new UnauthorizedError('New password must be at least 8 characters');
  }

  const hash = await bcrypt.hash(newPassword, 12);
  await sql`
    UPDATE users SET password_hash = ${hash}, updated_at = NOW()
    WHERE id = ${userId}
  `;

  logger.info({ userId }, 'Password changed');
}