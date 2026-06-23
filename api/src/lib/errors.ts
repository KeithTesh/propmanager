import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger';
import type { ApiError } from '../types';

// ─── TYPED ERROR CLASSES ──────────────────────────────────────────────────────

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly field?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(404, 'NOT_FOUND', id ? `${resource} '${id}' not found` : `${resource} not found`);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, field?: string) {
    super(400, 'VALIDATION_ERROR', message, field);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(403, 'FORBIDDEN', message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, 'CONFLICT', message);
  }
}

export class BusinessRuleError extends AppError {
  constructor(code: string, message: string) {
    super(422, code, message);
  }
}

// Specific business errors from simulations
export class StkLockError extends AppError {
  constructor(lockUntil: Date) {
    super(409, 'BILL_STK_LOCKED',
      `Bill is locked during active STK payment. Try again after ${lockUntil.toISOString()}`);
  }
}

export class SelfApprovalError extends AppError {
  constructor() {
    super(422, 'SELF_APPROVAL_FORBIDDEN',
      'Self-approval is not permitted. A different user must approve this action.');
  }
}

export class ProrationsNotConfiguredError extends AppError {
  constructor() {
    super(400, 'PRORATION_NOT_CONFIGURED',
      'Proration settings have not been configured for this company. Please complete the setup wizard.');
  }
}

// ─── GLOBAL ERROR HANDLER ────────────────────────────────────────────────────

export function globalErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Zod validation errors
  if (err instanceof ZodError) {
    const firstIssue = err.issues[0];
    const response: ApiError = {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: firstIssue?.message ?? 'Validation failed',
        field: firstIssue?.path.join('.'),
        details: err.issues.map(i => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      },
    };
    res.status(400).json(response);
    return;
  }

  // Known application errors
  if (err instanceof AppError) {
    const response: ApiError = {
      success: false,
      error: {
        code: err.code,
        message: err.message,
        field: err.field,
      },
    };
    res.status(err.statusCode).json(response);
    return;
  }

  // PostgreSQL unique violation
  if ((err as NodeJS.ErrnoException).code === '23505') {
    const response: ApiError = {
      success: false,
      error: {
        code: 'DUPLICATE_ENTRY',
        message: 'A record with these details already exists.',
      },
    };
    res.status(409).json(response);
    return;
  }

  // PostgreSQL business rule violations (RAISE EXCEPTION from triggers)
  if ((err as NodeJS.ErrnoException).code === 'P0001') {
    const response: ApiError = {
      success: false,
      error: {
        code: 'NOTIFICATION_CHANNEL_REQUIRED',
        message: err.message,
      },
    };
    res.status(422).json(response);
    return;
  }

  if ((err as NodeJS.ErrnoException).code === 'P0003') {
    const response: ApiError = {
      success: false,
      error: {
        code: 'BILL_STK_LOCKED',
        message: err.message,
      },
    };
    res.status(409).json(response);
    return;
  }

  if ((err as NodeJS.ErrnoException).code === 'P0004') {
    const response: ApiError = {
      success: false,
      error: {
        code: 'SELF_APPROVAL_FORBIDDEN',
        message: err.message,
      },
    };
    res.status(422).json(response);
    return;
  }

  // Unexpected errors — log fully, send generic response
  logger.error({ err, url: req.url, method: req.method }, 'Unhandled error');

  const response: ApiError = {
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred. Please try again.'
        : err.message,
    },
  };
  res.status(500).json(response);
}
