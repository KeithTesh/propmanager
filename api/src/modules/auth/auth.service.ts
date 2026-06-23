// api/src/modules/auth/auth.service.ts

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomUUID, randomInt } from 'crypto';
import { sql } from '../../db';
import { getRedis } from '../../db/redis';
import { UnauthorizedError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { sendSms } from '../../lib/sms';
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
    { expiresIn: ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'] }
  );
}

function generateRefreshToken(userId: string): string {
  return jwt.sign(
    { sub: userId, jti: randomUUID() },
    process.env.JWT_REFRESH_SECRET!,
    { expiresIn: REFRESH_TOKEN_TTL as jwt.SignOptions['expiresIn'] }
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

// ─── PASSWORD RESET (SMS-based) ───────────────────────────────────────────────
// Flow: forgotPassword (sends 6-digit code) → verifyResetCode (exchanges code
// for a one-time reset token) → resetPassword (exchanges token for new password).
// State lives in Redis only — codes/tokens are short-lived and single-use.

const RESET_CODE_TTL_SECONDS  = 10 * 60; // 10 minutes
const RESET_TOKEN_TTL_SECONDS = 10 * 60;
const RESET_CODE_MAX_ATTEMPTS = 5;

function normalisePhoneForLookup(raw: string): string {
  // Mirrors the normalisation used at registration time (register.router.ts)
  // so lookups match what's actually stored in users.phone.
  return raw.replace(/\s+/g, '').replace(/^0/, '254').replace(/^\+/, '');
}

/**
 * Request a password reset code via SMS.
 * Always resolves silently (even if the phone isn't registered) to avoid
 * leaking which phone numbers have accounts.
 */
export async function forgotPassword(phone: string): Promise<void> {
  const normalised = normalisePhoneForLookup(phone);

  const [user] = await sql`
    SELECT id FROM users
    WHERE phone = ${normalised} AND deleted_at IS NULL AND is_active = TRUE
    LIMIT 1
  `;

  if (!user) {
    logger.info({ phone: normalised }, 'Password reset requested for unknown/inactive phone');
    return;
  }

  const code = randomInt(100000, 1000000).toString(); // 6 digits
  const codeHash = await bcrypt.hash(code, 10);

  const redis = getRedis();
  await redis.set(
    `pwreset:code:${normalised}`,
    JSON.stringify({ userId: user.id, codeHash, attempts: 0 }),
    'EX', RESET_CODE_TTL_SECONDS
  );

  await sendSms(normalised, `Your PropManager password reset code is ${code}. It expires in 10 minutes. If you didn't request this, ignore this message.`);

  logger.info({ userId: user.id }, 'Password reset code sent');
}

/**
 * Verify a 6-digit reset code and exchange it for a one-time reset token.
 * The code is single-use — deleted from Redis on success.
 */
export async function verifyResetCode(phone: string, code: string): Promise<string> {
  const normalised = normalisePhoneForLookup(phone);
  const redis = getRedis();
  const key = `pwreset:code:${normalised}`;

  const raw = await redis.get(key);
  if (!raw) throw new UnauthorizedError('Invalid or expired code. Please request a new one.');

  const state = JSON.parse(raw) as { userId: string; codeHash: string; attempts: number };

  if (state.attempts >= RESET_CODE_MAX_ATTEMPTS) {
    await redis.del(key);
    throw new UnauthorizedError('Too many incorrect attempts. Please request a new code.');
  }

  const valid = await bcrypt.compare(code, state.codeHash);
  if (!valid) {
    state.attempts += 1;
    await redis.set(key, JSON.stringify(state), 'KEEPTTL');
    throw new UnauthorizedError('Invalid code.');
  }

  await redis.del(key);

  const resetToken = randomUUID();
  await redis.set(
    `pwreset:token:${resetToken}`,
    JSON.stringify({ userId: state.userId }),
    'EX', RESET_TOKEN_TTL_SECONDS
  );

  return resetToken;
}

/**
 * Exchange a verified reset token for a new password.
 * The token is single-use — deleted from Redis on success or failure.
 */
export async function resetPassword(resetToken: string, newPassword: string): Promise<void> {
  const redis = getRedis();
  const key = `pwreset:token:${resetToken}`;

  const raw = await redis.get(key);
  if (!raw) throw new UnauthorizedError('Invalid or expired reset token. Please start over.');

  await redis.del(key);

  const { userId } = JSON.parse(raw) as { userId: string };

  if (newPassword.length < 8) {
    throw new UnauthorizedError('New password must be at least 8 characters');
  }

  const hash = await bcrypt.hash(newPassword, 12);
  await sql`
    UPDATE users SET password_hash = ${hash}, updated_at = NOW()
    WHERE id = ${userId}
  `;

  logger.info({ userId }, 'Password reset via SMS code');
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