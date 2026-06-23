// web/src/lib/utils.ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, parseISO, isValid } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

// ─── TAILWIND CLASS HELPER ────────────────────────────────────────────────────

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ─── CURRENCY ─────────────────────────────────────────────────────────────────

/**
 * Format a number as Kenya Shillings
 * e.g. 32500 → "KES 32,500"
 */
export function formatKes(amount: number | null | undefined, opts?: {
  showCurrency?: boolean;
  decimals?: number;
}): string {
  if (amount == null) return '—';
  const { showCurrency = true, decimals = 0 } = opts ?? {};
  const formatted = amount.toLocaleString('en-KE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return showCurrency ? `KES ${formatted}` : formatted;
}

/**
 * Format as compact KES: 1,250,000 → "KES 1.25M"
 */
export function formatKesCompact(amount: number): string {
  if (amount >= 1_000_000) return `KES ${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000)     return `KES ${(amount / 1_000).toFixed(0)}K`;
  return formatKes(amount);
}

// ─── DATES ────────────────────────────────────────────────────────────────────

const NAIROBI_TZ = 'Africa/Nairobi';

/**
 * Format an ISO date string for display in Kenya timezone
 * e.g. "2026-03-01" → "1 Mar 2026"
 */
export function formatDate(date: string | Date | null | undefined, fmt = 'd MMM yyyy'): string {
  if (!date) return '—';
  try {
    const d = typeof date === 'string' ? parseISO(date) : date;
    if (!isValid(d)) return '—';
    return format(toZonedTime(d, NAIROBI_TZ), fmt);
  } catch {
    return '—';
  }
}

/**
 * Format month: "2026-03-01" → "March 2026"
 */
export function formatMonth(date: string | null | undefined): string {
  return formatDate(date, 'MMMM yyyy');
}

/**
 * Format relative: days overdue
 */
export function formatDaysOverdue(days: number): string {
  if (days <= 0) return 'Due today';
  if (days === 1) return '1 day overdue';
  return `${days} days overdue`;
}

// ─── BILL STATUS ──────────────────────────────────────────────────────────────

export const BILL_STATUS_LABELS: Record<string, string> = {
  draft:     'Draft',
  open:      'Open',
  partial:   'Partial',
  paid:      'Paid',
  overdue:   'Overdue',
  payment_received_pending_verification: 'Pending Verification',
  waived:    'Waived',
  void:      'Void',
};

export const BILL_STATUS_CLASSES: Record<string, string> = {
  draft:     'badge-draft',
  open:      'badge-open',
  partial:   'badge-partial',
  paid:      'badge-paid',
  overdue:   'badge-overdue',
  payment_received_pending_verification: 'badge-pending',
  waived:    'bg-purple-100 text-purple-800',
  void:      'badge-draft',
};

// ─── LEASE STATUS ─────────────────────────────────────────────────────────────

export const LEASE_STATUS_LABELS: Record<string, string> = {
  draft:      'Draft',
  active:     'Active',
  notice:     'Notice',
  terminated: 'Terminated',
  expired:    'Expired',
};

// ─── PAYMENT CHANNEL LABELS ───────────────────────────────────────────────────

export const PAYMENT_CHANNEL_LABELS: Record<string, string> = {
  mpesa_stk:     'M-Pesa STK',
  mpesa_paybill: 'M-Pesa PayBill',
  cash:          'Cash',
  bank_transfer: 'Bank Transfer',
  adjustment:    'Adjustment',
  reversal:      'Reversal',
};

// ─── MISC ─────────────────────────────────────────────────────────────────────

export function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map(n => n[0])
    .join('')
    .toUpperCase();
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? `${count} ${singular}` : `${count} ${plural ?? singular + 's'}`;
}