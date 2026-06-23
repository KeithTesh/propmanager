// api/src/modules/auth/auth.router.ts

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { login, refresh, logout, changePassword, forgotPassword, verifyResetCode, resetPassword } from './auth.service';
import { authenticate } from '../../middleware/auth';
import type { ApiResponse } from '../../types';

export const authRouter = Router();

const REFRESH_COOKIE = 'pm_refresh';
const isProd = process.env.NODE_ENV === 'production';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure:   isProd,
  // Web (Vercel) and API (Render) are different domains in production, so the
  // refresh cookie must be sent cross-site. 'none' requires secure: true.
  sameSite: isProd ? 'none' as const : 'lax' as const,
  maxAge:   7 * 24 * 60 * 60 * 1000,
  path:     '/',
};

// ─── POST /auth/login ─────────────────────────────────────────────────────────

authRouter.post('/login', async (req: Request, res: Response) => {
  const { email, password } = z.object({
    email:    z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
  }).parse(req.body);

  const result = await login(email, password);

  // Clear any existing cookie first to avoid duplicates, then set fresh one
  res.clearCookie(REFRESH_COOKIE, { path: '/' });
  res.cookie(REFRESH_COOKIE, result.tokens.refreshToken, COOKIE_OPTIONS);

  res.json({
    success: true,
    data: {
      user:    result.user,
      company: result.company,
      tokens: {
        accessToken: result.tokens.accessToken,
        expiresIn:   result.tokens.expiresIn,
      },
    },
  } satisfies ApiResponse<unknown>);
});

// ─── POST /auth/refresh ───────────────────────────────────────────────────────

authRouter.post('/refresh', async (req: Request, res: Response) => {
  // When browser sends duplicate cookies, take the last one (most recently set)
  const rawCookie = req.headers.cookie ?? '';
  const allValues = rawCookie.split(';')
    .map(c => c.trim())
    .filter(c => c.startsWith(REFRESH_COOKIE + '='))
    .map(c => c.slice(REFRESH_COOKIE.length + 1));
  const refreshToken = allValues.length > 0
    ? allValues[allValues.length - 1]  // take newest (last set)
    : req.cookies?.[REFRESH_COOKIE];

  if (!refreshToken) {
    res.status(401).json({
      success: false,
      error: { code: 'NO_REFRESH_TOKEN', message: 'No refresh token provided' },
    });
    return;
  }

  const result = await refresh(refreshToken);

  // Clear old token cookie before issuing new one
  res.clearCookie(REFRESH_COOKIE, { path: '/' });
  res.cookie(REFRESH_COOKIE, result.tokens.refreshToken, COOKIE_OPTIONS);

  res.json({
    success: true,
    data: {
      user:    result.user,
      company: result.company,
      tokens: {
        accessToken: result.tokens.accessToken,
        expiresIn:   result.tokens.expiresIn,
      },
    },
  } satisfies ApiResponse<unknown>);
});

// ─── POST /auth/logout ────────────────────────────────────────────────────────

authRouter.post('/logout', async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE];
  if (refreshToken) await logout(refreshToken);
  res.clearCookie(REFRESH_COOKIE, { ...COOKIE_OPTIONS, maxAge: 0 });
  res.json({ success: true, data: { message: 'Logged out successfully' } });
});

// ─── GET /auth/me ─────────────────────────────────────────────────────────────

authRouter.get('/me', authenticate, async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: { user: req.ctx.user },
  } satisfies ApiResponse<unknown>);
});

// ─── POST /auth/change-password ───────────────────────────────────────────────

authRouter.post('/change-password', authenticate, async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = z.object({
    currentPassword: z.string().min(1),
    newPassword:     z.string().min(8, 'Password must be at least 8 characters'),
  }).parse(req.body);

  await changePassword(req.ctx.userId, currentPassword, newPassword);

  res.json({ success: true, data: { message: 'Password changed successfully' } });
});

// ─── POST /auth/forgot-password ───────────────────────────────────────────────
// Tenant enters their phone number → receive SMS with 6-digit code (10 min TTL)

authRouter.post('/forgot-password', async (req: Request, res: Response) => {
  const { phone } = z.object({
    phone: z.string().min(9, 'Enter a valid phone number'),
  }).parse(req.body);

  await forgotPassword(phone);

  // Always return success to prevent phone number enumeration
  res.json({
    success: true,
    data: { message: 'If an account exists for this number, a reset code has been sent via SMS.' },
  });
});

// ─── POST /auth/verify-reset-code ─────────────────────────────────────────────
// Check the 6-digit code is valid before showing the new-password form

authRouter.post('/verify-reset-code', async (req: Request, res: Response) => {
  const { phone, code } = z.object({
    phone: z.string().min(9),
    code:  z.string().length(6),
  }).parse(req.body);

  const token = await verifyResetCode(phone, code);
  res.json({ success: true, data: { resetToken: token } });
});

// ─── POST /auth/reset-password ────────────────────────────────────────────────
// Exchange the verified reset token for a new password

authRouter.post('/reset-password', async (req: Request, res: Response) => {
  const { resetToken, newPassword } = z.object({
    resetToken:  z.string().min(1),
    newPassword: z.string().min(8, 'Password must be at least 8 characters'),
  }).parse(req.body);

  await resetPassword(resetToken, newPassword);
  res.json({ success: true, data: { message: 'Password reset successfully. You can now log in.' } });
});