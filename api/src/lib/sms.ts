// api/src/lib/sms.ts — Africa's Talking SMS wrapper + template engine

import { logger } from './logger';
import { sql } from '../db';

export interface SmsResult {
  success: boolean;
  messageId?: string;
  status?: string;
  error?: string;
}

// ─── Template engine ──────────────────────────────────────────────────────────

export interface TemplateVars {
  tenant_name?:  string;
  amount?:       string;
  unit?:         string;
  month?:        string;
  due_date?:     string;
  receipt?:      string;
  paybill?:      string;
  account_ref?:  string;
  property?:     string;
}

export function fillTemplate(template: string, vars: TemplateVars): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{${k}}`, v ?? '');
  }
  return out.trim();
}

// Fetch company template from DB, fall back to hardcoded default if not found
export async function getTemplate(companyId: string, type: string): Promise<string> {
  try {
    const [row] = await sql`
      SELECT template FROM sms_templates
      WHERE company_id = ${companyId}
        AND type       = ${type}
        AND is_active  = TRUE
    `;
    if (row?.template) return row.template;
  } catch {
    // DB error — fall through to default
  }
  return DEFAULT_TEMPLATES[type] ?? '{tenant_name}, message from your property manager.';
}

// Default templates (used as fallback if DB template missing)
export const DEFAULT_TEMPLATES: Record<string, string> = {
  rent_reminder:        'Dear {tenant_name}, your rent of KES {amount} for {month} is due on {due_date}. Pay via M-Pesa PayBill {paybill}, Account: {account_ref}.',
  payment_confirmation: 'Dear {tenant_name}, payment of KES {amount} for {month} received. Receipt: {receipt}. Thank you.',
  overdue:              'Dear {tenant_name}, your rent of KES {amount} for {month} is overdue. Please pay immediately to avoid penalties.',
  penalty:              'Dear {tenant_name}, a late payment penalty of KES {amount} has been added to your account for {month}.',
  custom_blast:         'Dear {tenant_name}, ',
};

// ─── Build messages from templates ───────────────────────────────────────────

export async function buildRentReminderMessage(companyId: string, opts: {
  tenantName: string; unitNumber: string; amount: number;
  forMonth: string | Date; dueDate: string | Date;
  paybillNumber?: string | null; accountRef?: string | null;
  propertyName?: string;
}): Promise<string> {
  const template = await getTemplate(companyId, 'rent_reminder');
  const month = new Date(opts.forMonth).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
  const due   = new Date(opts.dueDate).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
  return fillTemplate(template, {
    tenant_name: opts.tenantName,
    amount:      `KES ${Math.round(opts.amount).toLocaleString()}`,
    unit:        opts.unitNumber,
    month,
    due_date:    due,
    paybill:     opts.paybillNumber ?? '',
    account_ref: opts.accountRef ?? '',
    property:    opts.propertyName ?? '',
  });
}

export async function buildPaymentConfirmationMessage(companyId: string, opts: {
  tenantName: string; amount: number; forMonth: string | Date; receiptNumber: string;
  unitNumber?: string; propertyName?: string;
}): Promise<string> {
  const template = await getTemplate(companyId, 'payment_confirmation');
  const month = new Date(opts.forMonth).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
  return fillTemplate(template, {
    tenant_name: opts.tenantName,
    amount:      `KES ${Math.round(opts.amount).toLocaleString()}`,
    month,
    receipt:     opts.receiptNumber,
    unit:        opts.unitNumber ?? '',
    property:    opts.propertyName ?? '',
  });
}

export async function buildOverdueMessage(companyId: string, opts: {
  tenantName: string; amount: number; forMonth: string | Date;
  unitNumber?: string; propertyName?: string;
}): Promise<string> {
  const template = await getTemplate(companyId, 'overdue');
  const month = new Date(opts.forMonth).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
  return fillTemplate(template, {
    tenant_name: opts.tenantName,
    amount:      `KES ${Math.round(opts.amount).toLocaleString()}`,
    month,
    unit:        opts.unitNumber ?? '',
    property:    opts.propertyName ?? '',
  });
}

export async function buildPenaltyMessage(companyId: string, opts: {
  tenantName: string; amount: number; forMonth: string | Date;
}): Promise<string> {
  const template = await getTemplate(companyId, 'penalty');
  const month = new Date(opts.forMonth).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
  return fillTemplate(template, {
    tenant_name: opts.tenantName,
    amount:      `KES ${Math.round(opts.amount).toLocaleString()}`,
    month,
  });
}

// ─── Legacy sync exports (kept for backward compat — now async wrappers) ─────
// These use hardcoded defaults — only used in places not yet migrated

export function rentReminderMessage(opts: {
  tenantName: string; unitNumber: string; amount: number;
  forMonth: string; dueDate: string; paybillNumber?: string | null; accountRef?: string | null;
}): string {
  const month = new Date(opts.forMonth).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
  const due   = new Date(opts.dueDate).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
  let msg = `Dear ${opts.tenantName}, your rent of KES ${Math.round(opts.amount).toLocaleString()} for ${month} is due on ${due}.`;
  if (opts.paybillNumber && opts.accountRef) {
    msg += ` Pay via M-Pesa PayBill ${opts.paybillNumber}, Account: ${opts.accountRef}.`;
  }
  return msg;
}

export function paymentConfirmationMessage(opts: {
  tenantName: string; amount: number; forMonth: string; receiptNumber: string;
}): string {
  const month = new Date(opts.forMonth).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
  return `Dear ${opts.tenantName}, payment of KES ${Math.round(opts.amount).toLocaleString()} for ${month} received. Receipt: ${opts.receiptNumber}. Thank you.`;
}

export function overdueMessage(opts: {
  tenantName: string; amount: number; forMonth: string; daysOverdue: number;
}): string {
  const month = new Date(opts.forMonth).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
  return `Dear ${opts.tenantName}, your rent of KES ${Math.round(opts.amount).toLocaleString()} for ${month} is ${opts.daysOverdue} days overdue. Please pay immediately to avoid penalties.`;
}

// ─── Phone normalisation ──────────────────────────────────────────────────────
// AT requires E.164 format: +254XXXXXXXXX
// Handles: 0712345678 / 254712345678 / +254712345678 / 712345678

export function normalisePhone(raw: string): string {
  // Strip whitespace, dashes, parentheses
  let p = raw.replace(/[\s\-().]/g, '');
  // Strip leading +
  if (p.startsWith('+')) p = p.slice(1);
  // Leading 0 → Kenya country code
  if (p.startsWith('0')) p = '254' + p.slice(1);
  // Bare 9-digit number → assume Kenya
  if (/^\d{9}$/.test(p)) p = '254' + p;
  return '+' + p;
}

// ─── AT client ────────────────────────────────────────────────────────────────

function getAtClient() {
  const apiKey   = process.env.AT_API_KEY;
  const username = process.env.AT_USERNAME;
  if (!apiKey || !username) return null;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AfricasTalking = require('africastalking');
  return AfricasTalking({ apiKey, username });
}

const SMS_TIMEOUT_MS = 20_000; // 20 seconds — AT p95 latency is well under this

export async function sendSms(phone: string, message: string): Promise<SmsResult> {
  const apiKey   = process.env.AT_API_KEY;
  const username = process.env.AT_USERNAME;
  const senderId = process.env.AT_SENDER_ID || undefined;

  if (!apiKey || !username) {
    logger.warn({ phone }, 'SMS skipped — AT credentials not configured');
    return { success: false, error: 'AT credentials not configured' };
  }

  const normalised = normalisePhone(phone);

  if (!/^\+\d{10,15}$/.test(normalised)) {
    logger.warn({ phone, normalised }, 'SMS skipped — invalid phone number format');
    return { success: false, error: `Invalid phone number: ${phone}` };
  }

  try {
    const at = getAtClient();
    if (!at) return { success: false, error: 'AT client failed to initialize' };

    const opts: Record<string, any> = { to: [normalised], message };
    if (senderId) opts.from = senderId;

    // Wrap the AT call with an explicit timeout — the SDK has no built-in one
    const data = await Promise.race([
      at.SMS.send(opts),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`SMS timed out after ${SMS_TIMEOUT_MS / 1000}s`)), SMS_TIMEOUT_MS)
      ),
    ]);

    const recipient = data?.SMSMessageData?.Recipients?.[0];

    if (recipient?.statusCode === 101 || recipient?.status === 'Success') {
      logger.info({ phone: normalised, messageId: recipient.messageId }, 'SMS sent');
      return { success: true, messageId: recipient.messageId, status: recipient.status };
    }

    const error = recipient?.status ?? data?.SMSMessageData?.Message ?? 'Unknown AT error';
    logger.error({ phone: normalised, error, data }, 'SMS failed — AT returned error status');
    return { success: false, error };

  } catch (err: any) {
    logger.error({ phone: normalised, err: err.message }, 'SMS request failed');
    return { success: false, error: err.message };
  }
}