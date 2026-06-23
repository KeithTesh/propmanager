// api/src/modules/billing/billing.router.ts

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { withRLS, withRLSTransaction, RLSContext } from '../../db';
import { authenticate } from '../../middleware/auth';
import { logger } from '../../lib/logger';
import { calculateProration } from '../../lib/prorationEngine';
import { sendSms, rentReminderMessage } from '../../lib/sms';
import type { ApiResponse } from '../../types';

export const billingRouter = Router();
billingRouter.use(authenticate);

function ctx(req: Request): RLSContext {
  return { companyId: req.ctx.companyId!, userId: req.ctx.userId, userRole: req.ctx.userRole };
}

// ─── GET /billing/bills ───────────────────────────────────────────────────────

billingRouter.get('/bills', async (req: Request, res: Response) => {
  const { month, status } = req.query;

  const forMonth = month
    ? (month as string).slice(0, 7) + '-01'
    : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`;

  const statusFilter = typeof status === 'string' ? status : null;

  const bills = await withRLS(ctx(req), async (db) => {
    return db`
      SELECT
        mb.*,
        t.full_name   AS tenant_name,
        t.phone       AS tenant_phone,
        u.unit_number,
        p.name        AS property_name
      FROM monthly_bills mb
      JOIN leases l     ON l.id  = mb.lease_id
      JOIN tenants t    ON t.id  = l.primary_tenant_id
      JOIN units u      ON u.id  = mb.unit_id
      JOIN properties p ON p.id  = u.property_id
      WHERE mb.company_id = ${ctx(req).companyId}
        AND (
          TO_CHAR(mb.for_month, 'YYYY-MM') = ${forMonth.slice(0, 7)}
          OR (
            mb.bill_type IN ('signing', 'deposit')
            AND mb.status NOT IN ('paid', 'waived', 'void')
          )
        )
        ${statusFilter ? db`AND mb.status = ${statusFilter}` : db``}
      ORDER BY mb.due_date ASC, CASE mb.bill_type WHEN 'rent' THEN 1 WHEN 'signing' THEN 2 ELSE 3 END, t.full_name ASC
    `;
  });

  const billIds = bills.map((b: any) => b.id);
  const lineItems = billIds.length > 0
    ? await withRLS(ctx(req), async (db) => db`
        SELECT bill_id, item_type, amount, description, created_at
        FROM pending_bill_items
        WHERE bill_id = ANY(${billIds}::uuid[])
          AND apply_status = 'applied'
        ORDER BY created_at ASC
      `)
    : [];

  const itemsByBill: Record<string, any[]> = {};
  for (const item of lineItems) {
    if (!itemsByBill[(item as any).bill_id]) itemsByBill[(item as any).bill_id] = [];
    itemsByBill[(item as any).bill_id].push(item);
  }

  const billsWithItems = bills.map((b: any) => ({
    ...b,
    line_items: itemsByBill[b.id] ?? [],
  }));

  res.json({ success: true, data: { bills: billsWithItems, forMonth } } satisfies ApiResponse<unknown>);
});

// ─── POST /billing/generate ───────────────────────────────────────────────────

billingRouter.post('/generate', async (req: Request, res: Response) => {
  const { month } = z.object({
    month: z.string().optional(),
  }).parse(req.body);

  const companyId = req.ctx.companyId!;
  const userId    = req.ctx.userId;

  const now = new Date();
  const forMonth = month
    ? (month as string).slice(0, 7) + '-01'
    : `${now.getFullYear()}-${String(now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2).padStart(2, '0')}-01`;

  const [fy, fm] = forMonth.split('-').map(Number);

  const results = await withRLSTransaction(ctx(req), async (tx: any) => {
    const [company] = await tx`
      SELECT due_day, grace_period_days, payment_method, paybill_number
      FROM companies WHERE id = ${companyId}
    `;

    const dueDay = company.due_day ?? 1;
    const daysInMonth = new Date(fy, fm, 0).getDate();
    const clampedDay  = Math.min(dueDay, daysInMonth);
    const dueDate     = `${String(fy).padStart(4,'0')}-${String(fm).padStart(2,'0')}-${String(clampedDay).padStart(2,'0')}`;

    const leases = await tx`
      SELECT
        l.id, l.unit_id, l.monthly_rent, l.status,
        l.snap_payment_method, l.snap_paybill_number, l.snap_account_reference,
        l.start_date
      FROM leases l
      WHERE l.company_id = ${companyId}
        AND l.status IN ('active', 'notice')
        AND l.start_date < (${forMonth}::DATE + INTERVAL '1 month')::DATE
    `;

    let created = 0; let skipped = 0;

    for (const lease of leases) {
      const [existingRent] = await tx`
        SELECT id FROM monthly_bills
        WHERE lease_id = ${lease.id}
          AND TO_CHAR(for_month, 'YYYY-MM') = ${forMonth.slice(0, 7)}
          AND bill_type = 'rent'
      `;
      if (existingRent) { skipped++; continue; }

      const [existingSigning] = await tx`
        SELECT id FROM monthly_bills
        WHERE lease_id = ${lease.id}
          AND TO_CHAR(for_month, 'YYYY-MM') = ${forMonth.slice(0, 7)}
          AND bill_type = 'signing'
      `;
      if (existingSigning) { skipped++; continue; }

      const billId = randomUUID();
      await tx`
        INSERT INTO monthly_bills (
          id, company_id, lease_id, unit_id,
          for_month, due_date, bill_type,
          rent_amount, status,
          snap_payment_method, snap_paybill_number, snap_account_reference,
          generated_by, created_by
        ) VALUES (
          ${billId}, ${companyId}, ${lease.id}, ${lease.unit_id},
          ${forMonth}, ${dueDate}, 'rent',
          ${lease.monthly_rent}, 'open',
          ${lease.snap_payment_method ?? company.payment_method},
          ${lease.snap_paybill_number ?? company.paybill_number ?? null},
          ${lease.snap_account_reference},
          'manual', ${userId}
        )
      `;
      created++;
    }

    logger.info({ companyId, forMonth, created, skipped }, 'Bills generated');
    return { created, skipped, forMonth, total: leases.length };
  });

  res.json({ success: true, data: results } satisfies ApiResponse<unknown>);
});

// ─── POST /billing/bills/:id/waive ────────────────────────────────────────────

billingRouter.post('/bills/:id/waive', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { reason } = z.object({ reason: z.string().min(1) }).parse(req.body);

  const [updated] = await withRLS(ctx(req), async (db) => {
    return db`
      UPDATE monthly_bills SET
        status     = 'waived',
        waived_by  = ${req.ctx.userId},
        waived_at  = NOW(),
        waive_reason = ${reason},
        updated_at = NOW()
      WHERE id = ${id} AND company_id = ${ctx(req).companyId}
        AND status IN ('open','partial','overdue','draft')
      RETURNING id
    `;
  });

  if (!updated) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Bill not found or cannot be waived' } });
    return;
  }

  res.json({ success: true, data: { message: 'Bill waived' } } satisfies ApiResponse<unknown>);
});

// ─── PATCH /billing/bills/:id/publish ─────────────────────────────────────────

billingRouter.patch('/bills/:id/publish', async (req: Request, res: Response) => {
  const { id } = req.params;

  const [updated] = await withRLS(ctx(req), async (db) => {
    return db`
      UPDATE monthly_bills SET
        status       = 'open',
        published_at = NOW(),
        updated_at   = NOW()
      WHERE id = ${id} AND status = 'draft'
      RETURNING id
    `;
  });

  if (!updated) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Bill not found or not in draft' } });
    return;
  }

  res.json({ success: true, data: { message: 'Bill published' } } satisfies ApiResponse<unknown>);
});

// ─── POST /billing/recalculate-all ───────────────────────────────────────────

billingRouter.post('/recalculate-all', async (req: Request, res: Response) => {
  const { month, sendSmsNotification } = z.object({
    month:               z.string().optional(),
    sendSmsNotification: z.boolean().optional().default(false),
  }).parse(req.body);

  const now2 = new Date();
  const forMonth = month
    ? (month as string).slice(0, 7) + '-01'
    : `${now2.getFullYear()}-${String(now2.getMonth() + 1).padStart(2, '0')}-01`;

  const recalcToday = new Date().toISOString().slice(0, 10);
  const companyId   = ctx(req).companyId;

  const [company] = await withRLS(ctx(req), async (db) => db`
    SELECT payment_method, paybill_number,
      move_in_proration_mode, move_in_proration_cutoff,
      move_in_proration_method, min_proration_threshold
    FROM companies WHERE id = ${companyId}
  `);

  const bills = await withRLS(ctx(req), async (db) => db`
    SELECT
      mb.id, mb.due_date, mb.bill_type, mb.lease_id,
      mb.is_prorated, mb.proration_days, mb.proration_days_in_month,
      mb.snap_account_reference, mb.snap_paybill_number, mb.snap_payment_method,
      l.monthly_rent, l.start_date, l.status AS lease_status,
      l.snap_move_in_proration_mode, l.snap_move_in_proration_cutoff,
      l.snap_move_in_proration_method, l.snap_min_proration_threshold,
      t.full_name AS tenant_name, t.phone AS tenant_phone, t.notify_sms
    FROM monthly_bills mb
    JOIN leases l  ON l.id = mb.lease_id  AND l.deleted_at IS NULL
    JOIN tenants t ON t.id = l.primary_tenant_id AND t.deleted_at IS NULL
    WHERE mb.company_id = ${companyId}
      AND mb.for_month  = ${forMonth}
      AND mb.bill_type  = 'rent'
  `);

  let fixed = 0;

  for (const bill of bills) {
    await withRLSTransaction(ctx(req), async (tx: any) => {
      const proration = calculateProration({
        monthlyRent:           parseFloat(bill.monthly_rent),
        moveInDate:            bill.start_date,
        prorationType:         bill.snap_move_in_proration_mode    ?? company.move_in_proration_mode    ?? 'never',
        prorationCutoff:       bill.snap_move_in_proration_cutoff  ?? company.move_in_proration_cutoff  ?? null,
        prorationMethod:       bill.snap_move_in_proration_method  ?? company.move_in_proration_method  ?? 'actual_days',
        minProrationThreshold: bill.snap_min_proration_threshold   ?? company.min_proration_threshold   ?? 500,
      });

      const newRentAmount = bill.bill_type === 'signing' || bill.is_prorated
        ? proration.billAmount
        : parseFloat(bill.monthly_rent);

      const [{ actual_paid }] = await tx`
        SELECT COALESCE(SUM(amount), 0) AS actual_paid
        FROM payments WHERE bill_id = ${bill.id} AND undone_at IS NULL
      `;
      const paid      = parseFloat(actual_paid);
      const isPastDue = new Date(bill.due_date).toISOString().slice(0, 10) < recalcToday;
      const newStatus = paid >= newRentAmount - 0.01 ? 'paid'
        : paid > 0 ? 'partial'
        : isPastDue ? 'overdue'
        : 'open';

      await tx`
        UPDATE monthly_bills SET
          rent_amount             = ${newRentAmount},
          is_prorated             = ${proration.isProrated},
          proration_days          = ${proration.proratedDays ?? null},
          proration_days_in_month = ${proration.daysInMonth  ?? null},
          proration_description   = ${proration.description  ?? null},
          total_paid              = ${paid},
          status                  = ${newStatus},
          updated_at              = NOW()
        WHERE id = ${bill.id}
      `;
    });

    // Only SMS active/notice leases — terminated/expired get no recalculation reminders
    const canSms = sendSmsNotification
      && bill.tenant_phone
      && bill.notify_sms
      && ['active', 'notice'].includes(bill.lease_status);

    if (canSms) {
      const msg = rentReminderMessage({
        tenantName:    bill.tenant_name,
        unitNumber:    '',
        amount:        bill.monthly_rent,
        forMonth,
        dueDate:       bill.due_date,
        paybillNumber: bill.snap_paybill_number ?? company.paybill_number ?? '',
        accountRef:    bill.snap_account_reference,
      });
      await sendSms(bill.tenant_phone, msg).catch((e: any) =>
        logger.warn({ err: e.message, phone: bill.tenant_phone }, 'Recalculate SMS failed')
      );
    }

    fixed++;
  }

  res.json({ success: true, data: { fixed, forMonth } });
});

// ─── POST /billing/bills/:id/recalculate ─────────────────────────────────────

billingRouter.post('/bills/:id/recalculate', async (req: Request, res: Response) => {
  const { id } = req.params;

  const [updated] = await withRLSTransaction(ctx(req), async (tx: any) => {
    const [bill] = await tx`
      SELECT id, total_amount, due_date FROM monthly_bills WHERE id = ${id}
    `;
    if (!bill) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Bill not found' } });
      return [null];
    }

    const [{ actual_paid }] = await tx`
      SELECT COALESCE(SUM(amount), 0) AS actual_paid
      FROM payments
      WHERE bill_id = ${id} AND undone_at IS NULL
    `;

    const paid      = parseFloat(actual_paid);
    const total     = parseFloat(bill.total_amount);
    const today2    = new Date().toISOString().slice(0, 10);
    const isPastDue = new Date(bill.due_date).toISOString().slice(0, 10) < today2;
    const newStatus = paid >= total - 0.01 ? 'paid'
      : paid > 0 ? 'partial'
      : isPastDue ? 'overdue'
      : 'open';

    return tx`
      UPDATE monthly_bills SET
        total_paid = ${paid},
        status     = ${newStatus},
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, total_paid, status
    `;
  });

  if (!updated) return;
  res.json({ success: true, data: { bill: updated } });
});

// ─── GET /billing/orphaned ────────────────────────────────────────────────────

billingRouter.get('/orphaned', async (req: Request, res: Response) => {
  const bills = await withRLS(ctx(req), async (db) => {
    return db`
      SELECT
        mb.*,
        t.full_name  AS tenant_name,
        u.unit_number,
        p.name       AS property_name
      FROM monthly_bills mb
      JOIN leases l     ON l.id  = mb.lease_id
      JOIN tenants t    ON t.id  = l.primary_tenant_id
      JOIN units u      ON u.id  = mb.unit_id
      JOIN properties p ON p.id  = u.property_id
      WHERE mb.company_id = ${ctx(req).companyId}
        AND mb.bill_type = 'rent'
        AND mb.status    = 'open'
        AND mb.total_paid = 0
        AND mb.for_month < DATE_TRUNC('month', NOW())
        AND mb.due_date < (CURRENT_DATE - INTERVAL '7 days')
        AND NOT EXISTS (
          SELECT 1 FROM payments px
          WHERE px.bill_id = mb.id AND px.undone_at IS NULL
        )
      ORDER BY mb.created_at DESC
    `;
  });
  res.json({ success: true, data: { bills } } satisfies ApiResponse<unknown>);
});

// ─── DELETE /billing/bills/:id ────────────────────────────────────────────────

billingRouter.delete('/bills/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  const [hasPayments] = await withRLS(ctx(req), async (db) => {
    return db`SELECT id FROM payments WHERE bill_id = ${id} AND company_id = ${ctx(req).companyId} AND undone_at IS NULL LIMIT 1`;
  });

  if (hasPayments) {
    res.status(400).json({
      success: false,
      error: { code: 'HAS_PAYMENTS', message: 'Cannot delete a bill that has payments recorded against it. Waive it instead.' }
    });
    return;
  }

  await withRLS(ctx(req), async (db) => {
    return db`DELETE FROM monthly_bills WHERE id = ${id} AND company_id = ${ctx(req).companyId} AND bill_type != 'signing'`;
  });

  res.json({ success: true, data: { message: 'Bill deleted' } });
});

// ─── POST /billing/run-penalties ─────────────────────────────────────────────

billingRouter.post('/run-penalties', async (req: Request, res: Response) => {
  const c = ctx(req);
  const today = new Date().toISOString().slice(0, 10);

  const [company] = await withRLS(c, async (db) => db`
    SELECT penalty_type, penalty_value, penalty_applies_after_days, grace_period_days
    FROM companies WHERE id = ${c.companyId}
  `);

  if (!company || company.penalty_type === 'none') {
    res.json({ success: true, data: { applied: 0, skipped: 0, message: 'No penalty policy configured. Set one in Settings → Billing & Payments.' } });
    return;
  }

  const allRentBills = await withRLS(c, async (db) => db`
    SELECT b.id, b.status, b.bill_type, b.due_date, b.for_month, b.total_due,
      (b.due_date + ${company.grace_period_days}::INT + ${company.penalty_applies_after_days}::INT)::DATE AS penalty_eligible_date,
      EXISTS (SELECT 1 FROM monthly_bills pb WHERE pb.lease_id = b.lease_id AND pb.for_month = b.for_month AND pb.bill_type = 'penalty') AS already_has_penalty,
      t.full_name AS tenant_name
    FROM monthly_bills b
    JOIN leases l ON l.id = b.lease_id
    JOIN tenants t ON t.id = l.primary_tenant_id
    WHERE b.bill_type = 'rent'
    ORDER BY b.due_date ASC
  `);

  const overdueBills = await withRLS(c, async (db) => db`
    SELECT
      b.id          AS bill_id,
      b.lease_id,
      b.unit_id,
      b.for_month,
      b.total_due::NUMERIC AS total_due,
      b.snap_payment_method,
      b.snap_paybill_number,
      b.snap_account_reference,
      t.full_name   AS tenant_name,
      u.unit_number,
      p.name        AS property_name
    FROM monthly_bills b
    JOIN leases l      ON l.id  = b.lease_id
    JOIN tenants t     ON t.id  = l.primary_tenant_id
    JOIN units u       ON u.id  = b.unit_id
    JOIN properties p  ON p.id  = u.property_id
    WHERE b.status IN ('open', 'partial', 'overdue')
      AND b.bill_type = 'rent'
      AND b.total_due > 0
      AND (b.due_date + ${company.grace_period_days}::INT + ${company.penalty_applies_after_days}::INT)::DATE <= ${today}::DATE
      AND NOT EXISTS (
        SELECT 1 FROM monthly_bills pb
        WHERE pb.lease_id = b.lease_id
          AND pb.for_month = b.for_month
          AND pb.bill_type = 'penalty'
      )
  `);

  let applied = 0;
  let skipped = 0;
  const details: { tenant: string; unit: string; amount: number }[] = [];

  for (const bill of overdueBills) {
    const rawDue = bill.total_due;
    const penaltyRate = Number(company.penalty_value);
    const dueParsed = Number(rawDue);
    const penaltyAmount = company.penalty_type === 'flat'
      ? penaltyRate
      : Math.floor(Math.max(dueParsed, 0) * (penaltyRate / 100));

    logger.info({ billId: bill.bill_id, rawDue, dueParsed, penaltyRate, penaltyAmount, penaltyType: company.penalty_type }, 'Penalty calc debug');

    if (penaltyAmount <= 0) { skipped++; continue; }

    try {
      await withRLS(c, async (db) => db`
        INSERT INTO monthly_bills (
          company_id, lease_id, unit_id,
          for_month, due_date, bill_type,
          penalty_amount, total_paid, status,
          snap_payment_method, snap_paybill_number, snap_account_reference,
          generated_by, published_at
        ) VALUES (
          ${c.companyId}, ${bill.lease_id}, ${bill.unit_id},
          ${bill.for_month}, ${today}::DATE, 'penalty',
          ${penaltyAmount}, 0, 'open',
          ${bill.snap_payment_method ?? 'cash'}, ${bill.snap_paybill_number ?? null}, ${bill.snap_account_reference ?? null},
          'manual', NOW()
        )
        ON CONFLICT (lease_id, for_month, bill_type) DO NOTHING
      `);

      await withRLS(c, async (db) => db`
        UPDATE monthly_bills SET status = 'overdue', updated_at = NOW()
        WHERE id = ${bill.bill_id} AND status IN ('open', 'partial')
      `);

      details.push({ tenant: bill.tenant_name, unit: bill.unit_number, amount: penaltyAmount });
      applied++;
    } catch (err) {
      logger.error({ err: (err as any).message, billId: bill.bill_id }, 'Failed to apply manual penalty');
      skipped++;
    }
  }

  const policyDesc = company.penalty_type === 'flat'
    ? `KES ${company.penalty_value} flat fee`
    : `${company.penalty_value}% of amount due`;

  res.json({
    success: true,
    data: {
      applied,
      skipped,
      policy: policyDesc,
      graceDays: company.grace_period_days,
      penaltyAfterDays: company.penalty_applies_after_days,
      details,
      _debug: {
        today,
        totalRentBills: allRentBills.length,
        billsFoundEligible: overdueBills.length,
        allRentBills,
      },
    }
  });
});

// ─── GET /billing/penalty-preview ────────────────────────────────────────────

billingRouter.get('/penalty-preview', async (req: Request, res: Response) => {
  const c = ctx(req);
  const today = new Date().toISOString().slice(0, 10);

  const [company] = await withRLS(c, async (db) => db`
    SELECT penalty_type, penalty_value, penalty_applies_after_days, grace_period_days
    FROM companies WHERE id = ${c.companyId}
  `);

  if (!company || company.penalty_type === 'none') {
    res.json({ success: true, data: { eligible: [], policy: null } });
    return;
  }

  const eligible = await withRLS(c, async (db) => db`
    SELECT
      b.id          AS bill_id,
      b.for_month,
      b.due_date,
      b.total_due,
      b.status,
      t.full_name   AS tenant_name,
      t.phone       AS tenant_phone,
      u.unit_number,
      p.name        AS property_name,
      EXISTS (
        SELECT 1 FROM monthly_bills pb
        WHERE pb.lease_id = b.lease_id
          AND pb.for_month = b.for_month
          AND pb.bill_type = 'penalty'
      ) AS already_penalised
    FROM monthly_bills b
    JOIN leases l      ON l.id  = b.lease_id
    JOIN tenants t     ON t.id  = l.primary_tenant_id
    JOIN units u       ON u.id  = b.unit_id
    JOIN properties p  ON p.id  = u.property_id
    WHERE b.status IN ('open', 'partial', 'overdue')
      AND b.bill_type = 'rent'
      AND b.due_date < ${today}::DATE
    ORDER BY b.due_date ASC
  `);

  const policy = {
    type: company.penalty_type,
    value: Number(company.penalty_value),
    graceDays: Number(company.grace_period_days),
    penaltyAfterDays: Number(company.penalty_applies_after_days),
    eligibleToday: eligible.filter((b: any) => !b.already_penalised).length,
  };

  res.json({ success: true, data: { eligible, policy } });
});
