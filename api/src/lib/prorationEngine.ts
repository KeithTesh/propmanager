/**
 * Proration Engine
 *
 * TypeScript mirror of the DB proration_engine() PostgreSQL function.
 * Used in two places:
 *   1. Lease creation wizard → First Bill Preview (real-time, no DB round-trip)
 *   2. Billing cron → actual bill generation (calls DB function for atomicity)
 *
 * Decision 4: Company chooses proration method — no forced default.
 * Rec 26: Single shared function, no duplicate logic.
 * Rec 27: Always floor() to nearest whole shilling.
 * SIM-J4: Always generate human-readable description.
 * SIM-M1: Minimum threshold — below threshold charges full month.
 * SIM-M3: FLOOR enforced throughout.
 *
 * IMPORTANT: Never call this with live company settings.
 * Always use SNAPSHOT values from the lease. (SIM-J1, SIM-M5)
 */

import { getDaysInMonth, getDate } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import type { ProrationResult, ProrationType, ProrationMethod } from '../types';

const NAIROBI_TZ = 'Africa/Nairobi';

export interface ProrationInput {
  monthlyRent: number;
  moveInDate: Date | string;       // the actual move-in date
  prorationType: ProrationType;
  prorationCutoff: number | null;  // only used when type='after_cutoff'
  prorationMethod: ProrationMethod;
  minProrationThreshold: number;   // below this, charge full month
}

/**
 * Calculate proration for a partial first month.
 * Returns a ProrationResult with all computed values + human description.
 */
export function calculateProration(input: ProrationInput): ProrationResult {
  const {
    monthlyRent,
    moveInDate,
    prorationType,
    prorationCutoff,
    prorationMethod,
    minProrationThreshold,
  } = input;

  // Normalise to Kenya time (SIM-U4)
  const date = toZonedTime(
    typeof moveInDate === 'string' ? new Date(moveInDate) : moveInDate,
    NAIROBI_TZ
  );

  const dayOfMonth = getDate(date);
  const daysInMonth = getDaysInMonth(date);
  const daysOccupied = daysInMonth - dayOfMonth + 1;

  // ── Determine whether to prorate ────────────────────────────────────────────
  const shouldProrate = (() => {
    if (dayOfMonth === 1) return false;  // moved in on 1st — full month always
    switch (prorationType) {
      case 'always':        return true;
      case 'after_cutoff':  return dayOfMonth > (prorationCutoff ?? 1);
      case 'never':         return false;
    }
  })();

  if (!shouldProrate) {
    return {
      isProrated: false,
      proratedDays: null,
      daysInMonth: null,
      dailyRate: null,
      proratedAmount: null,
      fullMonthAmount: monthlyRent,
      billAmount: monthlyRent,
      description: `Full month rent: KES ${formatKes(monthlyRent)}`,
    };
  }

  // ── Calculate daily rate based on method ────────────────────────────────────
  const divisor = prorationMethod === 'actual_days' ? daysInMonth : 30;
  const rawDailyRate = monthlyRent / divisor;

  // Rec 27: FLOOR to nearest whole shilling
  const dailyRate = Math.floor(rawDailyRate * 100) / 100;
  const proratedAmount = Math.floor(dailyRate * daysOccupied);

  // ── Apply minimum threshold (SIM-M1) ────────────────────────────────────────
  if (proratedAmount < minProrationThreshold) {
    return {
      isProrated: false,
      proratedDays: daysOccupied,
      daysInMonth,
      dailyRate,
      proratedAmount,
      fullMonthAmount: monthlyRent,
      billAmount: monthlyRent,   // charge full month
      description:
        `Prorated amount KES ${formatKes(proratedAmount)} is below minimum ` +
        `threshold KES ${formatKes(minProrationThreshold)} — full month charged`,
    };
  }

  // ── Build human-readable description (SIM-J4) ────────────────────────────────
  const methodNote = prorationMethod === 'actual_days'
    ? `${daysInMonth}-day month`
    : '30-day standard';
  const description =
    `${daysOccupied} days × KES ${formatKes(dailyRate)}/day ` +
    `(${methodNote}) = KES ${formatKes(proratedAmount)}`;

  return {
    isProrated: true,
    proratedDays: daysOccupied,
    daysInMonth,
    dailyRate,
    proratedAmount,
    fullMonthAmount: monthlyRent,
    billAmount: proratedAmount,
    description,
  };
}

/**
 * Calculate move-out proration for final month.
 * Used in lease termination flow.
 */
export function calculateMoveOutProration(
  monthlyRent: number,
  moveOutDate: Date | string,
  moveOutProrationType: 'full_month' | 'to_notice_date' | 'to_actual_date',
  prorationMethod: ProrationMethod
): ProrationResult {
  if (moveOutProrationType === 'full_month') {
    return {
      isProrated: false,
      proratedDays: null,
      daysInMonth: null,
      dailyRate: null,
      proratedAmount: null,
      fullMonthAmount: monthlyRent,
      billAmount: monthlyRent,
      description: 'Full final month charged per lease terms',
    };
  }

  const date = toZonedTime(
    typeof moveOutDate === 'string' ? new Date(moveOutDate) : moveOutDate,
    NAIROBI_TZ
  );

  const dayOfMonth = getDate(date);
  const daysInMonth = getDaysInMonth(date);
  const divisor = prorationMethod === 'actual_days' ? daysInMonth : 30;
  const dailyRate = Math.floor((monthlyRent / divisor) * 100) / 100;
  const proratedAmount = Math.floor(dailyRate * dayOfMonth);

  return {
    isProrated: true,
    proratedDays: dayOfMonth,
    daysInMonth,
    dailyRate,
    proratedAmount,
    fullMonthAmount: monthlyRent,
    billAmount: proratedAmount,
    description:
      `${dayOfMonth} days × KES ${formatKes(dailyRate)}/day ` +
      `(${prorationMethod === 'actual_days' ? `${daysInMonth}-day month` : '30-day standard'}) ` +
      `= KES ${formatKes(proratedAmount)}`,
  };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function formatKes(amount: number): string {
  return amount.toLocaleString('en-KE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/**
 * Generate the first-bill preview shown in the lease creation wizard.
 * Returns both the prorated signing bill AND the first full recurring bill.
 * Decision 2: prorated first month collected at signing, alongside deposit.
 */
export function generateFirstBillPreview(input: ProrationInput & { dueDay: number }): {
  signingBill: ProrationResult & { dueDate: string };
  firstRecurringBill: { amount: number; forMonth: string; dueDate: string };
} {
  const prorationResult = calculateProration(input);

  const moveIn = toZonedTime(
    typeof input.moveInDate === 'string' ? new Date(input.moveInDate) : input.moveInDate,
    NAIROBI_TZ
  );

  // Signing bill is due immediately (same day as lease signing)
  const signingDueDate = moveIn.toISOString().slice(0, 10);

  // First recurring bill: 1st of next month
  const nextMonth = new Date(moveIn);
  nextMonth.setDate(1);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const nextMonthStr = nextMonth.toISOString().slice(0, 10);

  // Due date for recurring bill
  const recurringDue = new Date(nextMonth);
  recurringDue.setDate(input.dueDay);
  const recurringDueStr = recurringDue.toISOString().slice(0, 10);

  return {
    signingBill: {
      ...prorationResult,
      dueDate: signingDueDate,
    },
    firstRecurringBill: {
      amount: input.monthlyRent,
      forMonth: nextMonthStr,
      dueDate: recurringDueStr,
    },
  };
}
