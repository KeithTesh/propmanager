// api/src/modules/dashboard/dashboard.router.ts

import { Router, Request, Response } from 'express';
import { withRLS } from '../../db';
import { authenticate } from '../../middleware/auth';
import { getPropertyFilter } from '../../middleware/caretaker';
import type { ApiResponse, RLSContext } from '../../types';

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

function ctx(req: Request): RLSContext {
  return { companyId: req.ctx.companyId!, userId: req.ctx.userId, userRole: req.ctx.userRole };
}

dashboardRouter.get('/stats', async (req: Request, res: Response) => {
  const c   = ctx(req);
  const cid = c.companyId;
  const pf  = getPropertyFilter(req);
  const role = req.ctx.userRole;

  await withRLS(c, async (db) => db`
    UPDATE monthly_bills SET status = 'overdue', updated_at = NOW()
    WHERE company_id = ${cid}
      AND status IN ('open','partial')
      AND bill_type IN ('rent','signing')
      AND due_date < CURRENT_DATE
      ${pf ? db`AND unit_id IN (SELECT id FROM units WHERE property_id = ANY(${pf as any}) AND company_id = ${cid})` : db``}
  `);

  const [occupancy, revenue, revenueChart, billStatus, recentPayments, recentLeases, maintenanceSummary] =
    await Promise.all([

    withRLS(c, async (db) => {
      const [row] = await db`
        SELECT
          COUNT(u.id)                                       AS total_units,
          COUNT(u.id) FILTER (WHERE u.is_occupied = TRUE)  AS occupied,
          COUNT(u.id) FILTER (WHERE u.is_occupied = FALSE
            AND u.is_active = TRUE AND u.deleted_at IS NULL) AS vacant,
          COUNT(DISTINCT p.id)                             AS total_properties
        FROM properties p
        LEFT JOIN units u ON u.property_id = p.id AND u.deleted_at IS NULL AND u.company_id = ${cid}
        WHERE p.company_id = ${cid} AND p.deleted_at IS NULL
          ${pf ? db`AND p.id = ANY(${pf as any})` : db``}
      `;
      return row;
    }),

    withRLS(c, async (db) => {
      const [row] = await db`
        SELECT
          COALESCE(SUM(p.amount) FILTER (
            WHERE DATE_TRUNC('month', p.recorded_at) = DATE_TRUNC('month', NOW())
              AND p.undone_at IS NULL
          ), 0) AS collected_mtd,
          COALESCE(SUM(p.amount) FILTER (
            WHERE DATE_TRUNC('month', p.recorded_at) = DATE_TRUNC('month', NOW() - INTERVAL '1 month')
              AND p.undone_at IS NULL
          ), 0) AS collected_last_month,
          COALESCE((
            SELECT SUM(GREATEST(mb.total_due, 0)) FROM monthly_bills mb
            WHERE mb.company_id = ${cid} AND mb.status IN ('open','partial','overdue')
            ${pf ? db`AND mb.unit_id IN (SELECT id FROM units WHERE property_id = ANY(${pf as any}) AND company_id = ${cid})` : db``}
          ), 0) AS total_outstanding,
          COALESCE((
            SELECT SUM(mb.total_amount) FROM monthly_bills mb
            WHERE mb.company_id = ${cid}
              AND TO_CHAR(mb.for_month,'YYYY-MM') = TO_CHAR(NOW(),'YYYY-MM')
            ${pf ? db`AND mb.unit_id IN (SELECT id FROM units WHERE property_id = ANY(${pf as any}) AND company_id = ${cid})` : db``}
          ), 0) AS billed_mtd,
          COUNT(*) FILTER (WHERE p.undone_at IS NULL) AS payment_count_mtd
        FROM payments p
        JOIN leases l ON l.id = p.lease_id AND l.company_id = ${cid}
        JOIN units u  ON u.id = l.unit_id  AND u.company_id = ${cid}
        WHERE p.company_id = ${cid}
          AND DATE_TRUNC('month', p.recorded_at) = DATE_TRUNC('month', NOW())
          ${pf ? db`AND u.property_id = ANY(${pf as any})` : db``}
      `;
      return row;
    }),

    withRLS(c, async (db) => {
      return db`
        WITH months AS (
          SELECT
            DATE_TRUNC('month', p.recorded_at) AS month_trunc,
            TO_CHAR(DATE_TRUNC('month', p.recorded_at), 'Mon')     AS month_label,
            TO_CHAR(DATE_TRUNC('month', p.recorded_at), 'YYYY-MM') AS month_key,
            COALESCE(SUM(p.amount) FILTER (WHERE p.undone_at IS NULL), 0) AS collected
          FROM payments p
          JOIN leases l ON l.id = p.lease_id AND l.company_id = ${cid}
          JOIN units u  ON u.id = l.unit_id  AND u.company_id = ${cid}
          WHERE p.company_id = ${cid}
            AND p.recorded_at >= NOW() - INTERVAL '6 months'
            ${pf ? db`AND u.property_id = ANY(${pf as any})` : db``}
          GROUP BY DATE_TRUNC('month', p.recorded_at)
        ),
        billed AS (
          SELECT
            DATE_TRUNC('month', mb.for_month) AS month_trunc,
            COALESCE(SUM(mb.total_amount), 0) AS billed
          FROM monthly_bills mb
          JOIN leases l ON l.id = mb.lease_id AND l.company_id = ${cid}
          JOIN units u  ON u.id = mb.unit_id  AND u.company_id = ${cid}
          WHERE mb.company_id = ${cid}
            AND mb.for_month >= NOW() - INTERVAL '6 months'
            ${pf ? db`AND u.property_id = ANY(${pf as any})` : db``}
          GROUP BY DATE_TRUNC('month', mb.for_month)
        )
        SELECT m.month_label, m.month_key, m.collected, COALESCE(b.billed, 0) AS billed
        FROM months m LEFT JOIN billed b ON b.month_trunc = m.month_trunc
        ORDER BY m.month_trunc ASC
      `;
    }),

    withRLS(c, async (db) => {
      const [row] = await db`
        SELECT
          COUNT(*) FILTER (WHERE mb.status = 'paid' OR (mb.status != 'waived' AND mb.total_due <= 0)) AS paid,
          COUNT(*) FILTER (WHERE mb.status = 'partial' AND mb.total_due > 0)  AS partial,
          COUNT(*) FILTER (WHERE mb.status = 'open'    AND mb.total_due > 0)  AS open,
          COUNT(*) FILTER (WHERE mb.status = 'overdue' AND mb.total_due > 0)  AS overdue,
          COUNT(*) FILTER (WHERE mb.status = 'waived')                        AS waived
        FROM monthly_bills mb
        WHERE mb.company_id = ${cid}
          AND TO_CHAR(mb.for_month,'YYYY-MM') = TO_CHAR(NOW(),'YYYY-MM')
          ${pf ? db`AND mb.unit_id IN (SELECT id FROM units WHERE property_id = ANY(${pf as any}) AND company_id = ${cid})` : db``}
      `;
      return row;
    }),

    withRLS(c, async (db) => {
      return db`
        SELECT p.id, p.amount, p.channel, p.receipt_number, p.recorded_at,
          t.full_name AS tenant_name, u.unit_number, pr.name AS property_name
        FROM payments p
        JOIN leases l     ON l.id  = p.lease_id  AND l.company_id  = ${cid}
        JOIN tenants t    ON t.id  = l.primary_tenant_id AND t.company_id = ${cid}
        JOIN units u      ON u.id  = l.unit_id   AND u.company_id  = ${cid}
        JOIN properties pr ON pr.id = u.property_id AND pr.company_id = ${cid}
        WHERE p.company_id = ${cid} AND p.undone_at IS NULL
          ${pf ? db`AND pr.id = ANY(${pf as any})` : db``}
        ORDER BY p.recorded_at DESC LIMIT 8
      `;
    }),

    withRLS(c, async (db) => {
      return db`
        SELECT l.id, l.status, l.start_date, l.created_at, l.monthly_rent,
          t.full_name AS tenant_name, u.unit_number, p.name AS property_name
        FROM leases l
        JOIN tenants t    ON t.id  = l.primary_tenant_id AND t.company_id = ${cid}
        JOIN units u      ON u.id  = l.unit_id            AND u.company_id = ${cid}
        JOIN properties p ON p.id  = u.property_id         AND p.company_id = ${cid}
        WHERE l.company_id = ${cid}
          ${pf ? db`AND p.id = ANY(${pf as any})` : db``}
        ORDER BY l.created_at DESC LIMIT 5
      `;
    }),

    withRLS(c, async (db) => {
      const [row] = await db`
        SELECT
          COUNT(*) FILTER (WHERE m.status != 'closed')                           AS open_count,
          COUNT(*) FILTER (WHERE m.status != 'closed' AND m.priority = 'urgent') AS urgent_count,
          COUNT(*) FILTER (WHERE m.status = 'open')                              AS unacknowledged
        FROM maintenance_requests m
        WHERE m.company_id = ${cid}
          ${pf ? db`AND m.property_id = ANY(${pf as any})` : db``}
      `;
      return row;
    }),
  ]);

  if (role === 'caretaker') {
    return res.json({ success: true, data: { occupancy, revenue: null, revenueChart: [], billStatus: null, recentPayments: [], recentLeases: [], maintenanceSummary } } satisfies ApiResponse<unknown>);
  }

  res.json({ success: true, data: { occupancy, revenue, revenueChart, billStatus, recentPayments, recentLeases, maintenanceSummary } } satisfies ApiResponse<unknown>);
});