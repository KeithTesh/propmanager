// api/src/lib/audit.ts
// Writes immutable audit log entries for key financial mutations.
// Uses systemQuery to bypass RLS (audit_logs has no INSERT policy for app users).

import { systemQuery } from '../db';
import { logger } from './logger';

export type AuditAction = 'INSERT' | 'UPDATE' | 'DELETE' | 'SOFT_DELETE';

export interface AuditEntry {
  companyId: string;
  tableName: string;
  recordId: string;
  action: AuditAction;
  actorId?: string | null;
  actorRole?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  changedFields?: string[];
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await systemQuery(async (db) => db`
      INSERT INTO audit_logs (
        company_id, table_name, record_id, action,
        actor_id, actor_role,
        old_values, new_values, changed_fields,
        ip_address, user_agent
      ) VALUES (
        ${entry.companyId}::uuid,
        ${entry.tableName},
        ${entry.recordId}::uuid,
        ${entry.action},
        ${entry.actorId ?? null},
        ${entry.actorRole ?? null},
        ${entry.oldValues ? JSON.stringify(entry.oldValues) : null},
        ${entry.newValues ? JSON.stringify(entry.newValues) : null},
        ${entry.changedFields ?? null},
        ${entry.ipAddress ?? null},
        ${entry.userAgent ?? null}
      )
    `);
  } catch (err) {
    // Audit failures must never break the main operation
    logger.error({ err, entry }, 'Failed to write audit log');
  }
}

// Convenience: fired after any payment recorded
export async function auditPayment(opts: {
  companyId: string; paymentId: string; leaseId: string; billId: string;
  amount: number; channel: string; actorId?: string | null; actorRole?: string | null;
  ipAddress?: string | null; userAgent?: string | null;
}) {
  await writeAudit({
    companyId:  opts.companyId,
    tableName:  'payments',
    recordId:   opts.paymentId,
    action:     'INSERT',
    actorId:    opts.actorId,
    actorRole:  opts.actorRole,
    newValues:  { lease_id: opts.leaseId, bill_id: opts.billId, amount: opts.amount, channel: opts.channel },
    changedFields: ['amount','channel','bill_id'],
    ipAddress:  opts.ipAddress,
    userAgent:  opts.userAgent,
  });
}

// Convenience: payment undone
export async function auditPaymentUndo(opts: {
  companyId: string; paymentId: string; amount: number;
  actorId?: string | null; actorRole?: string | null;
  ipAddress?: string | null;
}) {
  await writeAudit({
    companyId:  opts.companyId,
    tableName:  'payments',
    recordId:   opts.paymentId,
    action:     'UPDATE',
    actorId:    opts.actorId,
    actorRole:  opts.actorRole,
    oldValues:  { undone_at: null },
    newValues:  { undone_at: new Date().toISOString(), amount: opts.amount },
    changedFields: ['undone_at'],
    ipAddress:  opts.ipAddress,
  });
}

// Convenience: bill waived
export async function auditBillWaived(opts: {
  companyId: string; billId: string; reason: string;
  actorId?: string | null; actorRole?: string | null; ipAddress?: string | null;
}) {
  await writeAudit({
    companyId:  opts.companyId,
    tableName:  'monthly_bills',
    recordId:   opts.billId,
    action:     'UPDATE',
    actorId:    opts.actorId,
    actorRole:  opts.actorRole,
    oldValues:  { status: 'open' },
    newValues:  { status: 'waived', waive_reason: opts.reason },
    changedFields: ['status','waive_reason'],
    ipAddress:  opts.ipAddress,
  });
}

// Convenience: penalty applied
export async function auditPenaltyApplied(opts: {
  companyId: string; billId: string; amount: number; leaseId: string;
  actorId?: string | null; actorRole?: string | null;
}) {
  await writeAudit({
    companyId:  opts.companyId,
    tableName:  'monthly_bills',
    recordId:   opts.billId,
    action:     'INSERT',
    actorId:    opts.actorId,
    actorRole:  opts.actorRole,
    newValues:  { bill_type: 'penalty', penalty_amount: opts.amount, lease_id: opts.leaseId },
    changedFields: ['penalty_amount'],
  });
}

// Convenience: expense charged to tenant
export async function auditExpenseCharged(opts: {
  companyId: string; expenseId: string; billId: string; amount: number;
  chargeMode: string; actorId?: string | null; actorRole?: string | null;
}) {
  await writeAudit({
    companyId:  opts.companyId,
    tableName:  'expenses',
    recordId:   opts.expenseId,
    action:     'UPDATE',
    actorId:    opts.actorId,
    actorRole:  opts.actorRole,
    newValues:  { charged_to_bill_id: opts.billId, amount: opts.amount, charge_mode: opts.chargeMode },
    changedFields: ['charged_to_bill_id'],
  });
}

// Convenience: lease status change
export async function auditLeaseStatusChange(opts: {
  companyId: string; leaseId: string; oldStatus: string; newStatus: string;
  actorId?: string | null; actorRole?: string | null; ipAddress?: string | null;
}) {
  await writeAudit({
    companyId:  opts.companyId,
    tableName:  'leases',
    recordId:   opts.leaseId,
    action:     'UPDATE',
    actorId:    opts.actorId,
    actorRole:  opts.actorRole,
    oldValues:  { status: opts.oldStatus },
    newValues:  { status: opts.newStatus },
    changedFields: ['status'],
    ipAddress:  opts.ipAddress,
  });
}