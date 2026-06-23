import { Router, Request, Response } from 'express';
import { withRLS, RLSContext } from '../../db';
import { authenticate } from '../../middleware/auth';
import type { ApiResponse } from '../../types';

export const auditRouter = Router();
auditRouter.use(authenticate);

function ctx(req: Request): RLSContext {
  return { companyId: req.ctx.companyId!, userId: req.ctx.userId, userRole: req.ctx.userRole };
}

// Human-readable label for each table+action combo
function eventLabel(tableName: string, action: string, newValues: Record<string, unknown> | null, oldValues: Record<string, unknown> | null): string {
  switch (tableName) {
    case 'payments':
      if (action === 'INSERT') return 'Payment recorded';
      if (action === 'UPDATE') return 'Payment reversed';
      break;
    case 'monthly_bills':
      if (action === 'UPDATE' && newValues?.status === 'waived') return 'Bill waived';
      if (action === 'UPDATE' && newValues?.status === 'paid')   return 'Bill marked paid';
      if (action === 'INSERT' && newValues?.bill_type === 'penalty')    return 'Late penalty applied';
      if (action === 'INSERT' && newValues?.bill_type === 'rent')       return 'Rent bill generated';
      if (action === 'INSERT' && newValues?.bill_type === 'signing')    return 'Signing fee bill generated';
      if (action === 'INSERT' && newValues?.bill_type === 'utility')    return 'Utility bill added';
      if (action === 'UPDATE') return 'Bill updated';
      break;
    case 'expenses':
      if (action === 'UPDATE' && newValues?.charged_to_bill_id) return 'Expense charged to tenant';
      if (action === 'INSERT') return 'Expense recorded';
      if (action === 'DELETE' || action === 'SOFT_DELETE')       return 'Expense deleted';
      break;
    case 'leases':
      if (action === 'INSERT')                                   return 'Lease created';
      if (action === 'UPDATE' && newValues?.status === 'terminated') return 'Lease terminated';
      if (action === 'UPDATE' && newValues?.status === 'expired')    return 'Lease expired';
      if (action === 'UPDATE' && newValues?.status === 'active')     return 'Lease activated';
      if (action === 'UPDATE' && newValues?.status)               return `Lease → ${newValues.status}`;
      if (action === 'UPDATE')                                    return 'Lease updated';
      break;
    case 'tenants':
      if (action === 'INSERT') return 'Tenant created';
      if (action === 'UPDATE' && newValues?.deleted_at) return 'Tenant deleted';
      if (action === 'UPDATE') return 'Tenant updated';
      break;
    case 'properties':
      if (action === 'INSERT') return 'Property created';
      if (action === 'UPDATE' && newValues?.deleted_at) return 'Property deleted';
      if (action === 'UPDATE') return 'Property updated';
      if (action === 'DELETE') return 'Property deleted';
      break;
    case 'units':
      if (action === 'INSERT') return 'Unit created';
      if (action === 'UPDATE' && newValues?.deleted_at) return 'Unit deleted';
      if (action === 'UPDATE' && newValues?.is_occupied === true)  return 'Unit occupied';
      if (action === 'UPDATE' && newValues?.is_occupied === false) return 'Unit vacated';
      if (action === 'UPDATE') return 'Unit updated';
      break;
    case 'users':
      if (action === 'INSERT') return 'Staff account created';
      if (action === 'UPDATE' && newValues?.is_active === false) return 'Staff account deactivated';
      if (action === 'UPDATE' && newValues?.is_active === true)  return 'Staff account reactivated';
      if (action === 'UPDATE' && newValues?.password_hash)       return 'Password reset';
      if (action === 'UPDATE') return 'Staff profile updated';
      break;
    case 'maintenance_requests':
      if (action === 'INSERT') return 'Maintenance request logged';
      if (action === 'UPDATE' && newValues?.status === 'closed')      return 'Maintenance closed';
      if (action === 'UPDATE' && newValues?.status === 'in_progress')  return 'Maintenance started';
      if (action === 'UPDATE' && newValues?.assigned_to)               return 'Maintenance assigned';
      if (action === 'UPDATE') return 'Maintenance updated';
      break;
    case 'companies':
      if (action === 'UPDATE') return 'Company settings updated';
      break;
    case 'caretaker_permissions':
      if (action === 'INSERT' || action === 'UPDATE') return 'Caretaker permissions updated';
      break;
    case 'manager_property_assignments':
      if (action === 'INSERT' || action === 'UPDATE') return 'Manager property assignment updated';
      break;
    case 'notifications':
      if (action === 'INSERT') return 'Notification sent';
      break;
  }
  const labels: Record<string, string> = { INSERT: 'Created', UPDATE: 'Updated', DELETE: 'Deleted', SOFT_DELETE: 'Deleted' };
  return `${labels[action] ?? action}: ${tableName.replace(/_/g, ' ')}`;
}

// Table groups for filter UI
export const AUDIT_TABLE_GROUPS = {
  'Financial':    ['payments', 'monthly_bills', 'expenses'],
  'Properties':   ['properties', 'units'],
  'Tenants':      ['tenants', 'leases'],
  'Maintenance':  ['maintenance_requests'],
  'Staff':        ['users', 'caretaker_permissions', 'manager_property_assignments'],
  'Settings':     ['companies'],
  'Notifications':['notifications'],
};

// ─── GET /audit ───────────────────────────────────────────────────────────────
auditRouter.get('/', async (req: Request, res: Response) => {
  const { table, actor, action, from, to, group, limit = '100', offset = '0' } = req.query;
  const c = ctx(req);

  const actorIsSystem = actor === 'system';
  const actorUuid     = actor && !actorIsSystem ? actor as string : null;

  // Resolve table filter from group
  let tablesToFilter: string[] | null = null;
  if (group && AUDIT_TABLE_GROUPS[group as keyof typeof AUDIT_TABLE_GROUPS]) {
    tablesToFilter = AUDIT_TABLE_GROUPS[group as keyof typeof AUDIT_TABLE_GROUPS];
  }
  if (table) tablesToFilter = [table as string];

  const logs = await withRLS(c, async (db) => db`
    SELECT
      al.id, al.table_name, al.record_id, al.action,
      al.actor_id, al.actor_role,
      al.old_values, al.new_values, al.changed_fields,
      al.ip_address, al.created_at,
      u.full_name AS actor_name
    FROM audit_logs al
    LEFT JOIN users u ON u.id = al.actor_id
    WHERE al.company_id = ${c.companyId}
      ${tablesToFilter    ? db`AND al.table_name = ANY(${tablesToFilter})` : db``}
      ${actorIsSystem     ? db`AND al.actor_id IS NULL`                    : db``}
      ${actorUuid         ? db`AND al.actor_id = ${actorUuid}::uuid`       : db``}
      ${action            ? db`AND al.action   = ${action}`                : db``}
      ${from              ? db`AND al.created_at >= ${from}::TIMESTAMPTZ`  : db``}
      ${to                ? db`AND al.created_at <= ${to}::TIMESTAMPTZ`    : db``}
    ORDER BY al.created_at DESC
    LIMIT  ${parseInt(limit as string)}
    OFFSET ${parseInt(offset as string)}
  `);

  const parse = (v: unknown) => {
    if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } }
    return v;
  };

  const enriched = logs.map((l: any) => {
    const newVals = parse(l.new_values);
    const oldVals = parse(l.old_values);
    return {
      ...l,
      old_values:  oldVals,
      new_values:  newVals,
      event_label: eventLabel(l.table_name, l.action, newVals, oldVals),
    };
  });

  const [{ total }] = await withRLS(c, async (db) => db`
    SELECT COUNT(*) AS total FROM audit_logs
    WHERE company_id = ${c.companyId}
      ${tablesToFilter    ? db`AND table_name = ANY(${tablesToFilter})` : db``}
      ${actorIsSystem     ? db`AND actor_id IS NULL`                    : db``}
      ${actorUuid         ? db`AND actor_id  = ${actorUuid}::uuid`      : db``}
      ${action            ? db`AND action    = ${action}`               : db``}
      ${from              ? db`AND created_at >= ${from}::TIMESTAMPTZ`  : db``}
      ${to                ? db`AND created_at <= ${to}::TIMESTAMPTZ`    : db``}
  `);

  res.json({
    success: true,
    data: {
      logs: enriched,
      total: parseInt(total),
      groups: Object.keys(AUDIT_TABLE_GROUPS),
    },
  } satisfies ApiResponse<unknown>);
});

// ─── GET /audit/actors ────────────────────────────────────────────────────────
auditRouter.get('/actors', async (req: Request, res: Response) => {
  const c = ctx(req);
  const actors = await withRLS(c, async (db) => db`
    SELECT DISTINCT al.actor_id, u.full_name, u.role
    FROM audit_logs al
    LEFT JOIN users u ON u.id = al.actor_id
    WHERE al.company_id = ${c.companyId} AND al.actor_id IS NOT NULL
    ORDER BY u.full_name
  `);
  res.json({ success: true, data: { actors } } satisfies ApiResponse<unknown>);
});