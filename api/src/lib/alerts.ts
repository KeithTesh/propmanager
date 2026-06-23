// api/src/lib/alerts.ts
// Typed alert factories — all use inAppNotify which writes to inapp_alerts.

import { notifyAllStaff, notifyManagers, notifyFinance, notifyOwners, notifyUser } from './inAppNotify';
import { withRLS, RLSContext } from '../db';

const KES = (n: number | string) =>
  'KES ' + Number(n).toLocaleString('en-KE', { maximumFractionDigits: 0 });

// ─── Tenant user helper ───────────────────────────────────────────────────────

export async function getTenantUserIdFromLease(ctx: RLSContext, leaseId: string): Promise<string | null> {
  try {
    const [row] = await withRLS(ctx, async (db) => db`
      SELECT t.user_id FROM leases l JOIN tenants t ON t.id = l.primary_tenant_id WHERE l.id = ${leaseId}
    `);
    return row?.user_id ?? null;
  } catch { return null; }
}

// ─── PAYMENT ALERTS ───────────────────────────────────────────────────────────

export async function alertPaymentReceived(ctx: RLSContext, opts: {
  tenantName: string; amount: number; forMonth: string; receiptNo: string; tenantUserId?: string | null;
}) {
  const month = new Date(opts.forMonth).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
  await notifyAllStaff(ctx, {
    type: 'payment_received', link: '/payments',
    title: 'Payment received',
    body: `${opts.tenantName} paid ${KES(opts.amount)} for ${month} · Receipt: ${opts.receiptNo}`,
  });
  if (opts.tenantUserId) {
    await notifyUser(ctx, opts.tenantUserId, {
      type: 'payment_received', link: '/portal/payments',
      title: 'Payment confirmed ✓',
      body: `Your payment of ${KES(opts.amount)} for ${month} has been received. Receipt: ${opts.receiptNo}`,
    });
  }
}

export async function alertPaymentReversed(ctx: RLSContext, opts: {
  tenantName: string; amount: number; reason: string;
}) {
  await notifyFinance(ctx, {
    type: 'payment_reversed', link: '/payments',
    title: 'Payment reversed',
    body: `${KES(opts.amount)} for ${opts.tenantName} was reversed. Reason: ${opts.reason}`,
  });
}

// ─── LEASE ALERTS ─────────────────────────────────────────────────────────────

export async function alertLeaseCreated(ctx: RLSContext, opts: {
  tenantName: string; unitNumber: string; propertyName: string; tenantUserId?: string | null;
}) {
  await notifyManagers(ctx, {
    type: 'lease_created', link: '/leases',
    title: 'New lease created',
    body: `${opts.tenantName} — Unit ${opts.unitNumber}, ${opts.propertyName}`,
  });
  if (opts.tenantUserId) {
    await notifyUser(ctx, opts.tenantUserId, {
      type: 'lease_created', link: '/portal',
      title: 'Your lease is active',
      body: `Your lease for Unit ${opts.unitNumber} at ${opts.propertyName} has been created.`,
    });
  }
}

export async function alertLeaseTerminated(ctx: RLSContext, opts: {
  tenantName: string; unitNumber: string; tenantUserId?: string | null;
}) {
  await notifyManagers(ctx, {
    type: 'lease_terminated', link: '/leases',
    title: 'Lease terminated',
    body: `${opts.tenantName} · Unit ${opts.unitNumber} lease has been terminated`,
  });
  if (opts.tenantUserId) {
    await notifyUser(ctx, opts.tenantUserId, {
      type: 'lease_terminated', link: '/portal',
      title: 'Lease terminated',
      body: `Your lease for Unit ${opts.unitNumber} has been terminated.`,
    });
  }
}

export async function alertVacateNotice(ctx: RLSContext, opts: {
  tenantName: string; unitNumber: string; moveOutDate: string;
  tenantUserId?: string | null; initiatedByTenant?: boolean;
}) {
  const date = new Date(opts.moveOutDate).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
  const who = opts.initiatedByTenant ? `${opts.tenantName} has submitted` : 'Vacate notice issued for';
  await notifyManagers(ctx, {
    type: 'vacate_notice', link: '/leases',
    title: 'Vacate notice',
    body: `${who} Unit ${opts.unitNumber}. Move-out: ${date}`,
  });
  if (opts.tenantUserId && !opts.initiatedByTenant) {
    await notifyUser(ctx, opts.tenantUserId, {
      type: 'vacate_notice', link: '/portal',
      title: 'Vacate notice recorded',
      body: `A vacate notice has been recorded for your unit. Move-out: ${date}`,
    });
  }
}

export async function alertLeaseExtensionRequest(ctx: RLSContext, opts: {
  tenantName: string; unitNumber: string; requestedDate: string;
}) {
  const date = new Date(opts.requestedDate).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
  await notifyManagers(ctx, {
    type: 'extension_request', link: '/leases',
    title: 'Lease extension request',
    body: `${opts.tenantName} (Unit ${opts.unitNumber}) requested extension to ${date}`,
  });
}

export async function alertLeaseExtensionReviewed(ctx: RLSContext, opts: {
  tenantUserId: string; unitNumber: string; status: 'approved' | 'rejected'; newEndDate?: string; notes?: string;
}) {
  const approved = opts.status === 'approved';
  const date = opts.newEndDate
    ? new Date(opts.newEndDate).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
  await notifyUser(ctx, opts.tenantUserId, {
    type: 'extension_reviewed', link: '/portal',
    title: approved ? 'Lease extension approved ✓' : 'Lease extension declined',
    body: approved
      ? `Your lease extension has been approved. New end date: ${date}`
      : `Your extension request was not approved.${opts.notes ? ' Note: ' + opts.notes : ''}`,
  });
}

// ─── MAINTENANCE ALERTS ───────────────────────────────────────────────────────

export async function alertMaintenanceCreated(ctx: RLSContext, opts: {
  unitNumber: string; title: string; priority: string;
}) {
  await notifyManagers(ctx, {
    type: 'maintenance_request', link: '/maintenance',
    title: `New maintenance request · ${opts.priority} priority`,
    body: `Unit ${opts.unitNumber}: ${opts.title}`,
  });
}

export async function alertMaintenanceUpdated(ctx: RLSContext, opts: {
  unitNumber: string; title: string; status: string; tenantUserId?: string | null;
}) {
  if (opts.status === 'resolved' && opts.tenantUserId) {
    await notifyUser(ctx, opts.tenantUserId, {
      type: 'maintenance_resolved', link: '/portal/maintenance',
      title: 'Maintenance request resolved ✓',
      body: `Your request "${opts.title}" for Unit ${opts.unitNumber} has been resolved.`,
    });
  }
}

// ─── EXPENSE ALERTS ───────────────────────────────────────────────────────────

export async function alertExpensePending(ctx: RLSContext, opts: {
  description: string; amount: number; submittedByName: string;
}) {
  await notifyFinance(ctx, {
    type: 'expense_pending', link: '/expenses',
    title: 'Expense awaiting approval',
    body: `${opts.submittedByName}: ${opts.description} · ${KES(opts.amount)}`,
  });
}

export async function alertExpenseReviewed(ctx: RLSContext, opts: {
  submittedById: string; description: string; amount: number; status: 'approved' | 'rejected';
}) {
  await notifyUser(ctx, opts.submittedById, {
    type: 'expense_reviewed', link: '/expenses',
    title: opts.status === 'approved' ? 'Expense approved ✓' : 'Expense not approved',
    body: `"${opts.description}" (${KES(opts.amount)}) has been ${opts.status}.`,
  });
}

// ─── PAYROLL ALERTS ───────────────────────────────────────────────────────────

export async function alertPayrollRunCreated(ctx: RLSContext, opts: {
  month: string; employeeCount: number; totalNet: number;
}) {
  const month = new Date(opts.month).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
  await notifyFinance(ctx, {
    type: 'payroll_ready', link: '/payroll',
    title: 'Payroll run ready for approval',
    body: `${month} payroll · ${opts.employeeCount} employees · ${KES(opts.totalNet)} total net pay`,
  });
}

export async function alertPayrollApproved(ctx: RLSContext, opts: {
  month: string; totalNet: number; approvedByName: string;
}) {
  const month = new Date(opts.month).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
  await notifyOwners(ctx, {
    type: 'payroll_approved', link: '/payroll',
    title: 'Payroll approved',
    body: `${month} payroll (${KES(opts.totalNet)}) approved by ${opts.approvedByName}`,
  });
}

export async function alertPayrollPaid(ctx: RLSContext, opts: {
  month: string; totalNet: number;
}) {
  const month = new Date(opts.month).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
  await notifyAllStaff(ctx, {
    type: 'payroll_paid', link: '/payroll',
    title: 'Payroll marked as paid',
    body: `${month} payroll of ${KES(opts.totalNet)} has been marked as paid`,
  });
}