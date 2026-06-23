// api/src/modules/notifications/notifications.router.ts

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { withRLS, withRLSTransaction, RLSContext } from '../../db';
import { getPropertyFilter } from '../../middleware/caretaker';
import { sendSms, buildRentReminderMessage, buildPaymentConfirmationMessage } from '../../lib/sms';
import { logger } from '../../lib/logger';
import type { ApiResponse } from '../../types';

export const notificationsRouter = Router();
// NOTE: authenticate is applied at server level — do NOT add it here

function ctx(req: Request): RLSContext {
  return { companyId: req.ctx.companyId!, userId: req.ctx.userId, userRole: req.ctx.userRole };
}

// ─── GET /notifications — list notifications for THIS company only ─────────────

notificationsRouter.get('/', async (req: Request, res: Response) => {
  const { limit = '100', status, archived } = req.query as Record<string, string | undefined>;
  const c          = ctx(req);
  const cid        = c.companyId;
  const propFilter = getPropertyFilter(req);
  const showArchived = archived === 'true';

  const notifications = await withRLS(c, async (db) => {
    return db`
      SELECT
        n.id, n.company_id, n.channel, n.recipient, n.body, n.status,
        n.tenant_id, n.bill_id, n.attempt_count,
        n.sent_at, n.created_at, n.at_message_id, n.at_error,
        n.archived_at,
        t.full_name AS tenant_name,
        u.unit_number,
        p.name      AS property_name
      FROM notifications n
      LEFT JOIN tenants t       ON t.id  = n.tenant_id   AND t.company_id  = ${cid}
      LEFT JOIN monthly_bills mb ON mb.id = n.bill_id     AND mb.company_id = ${cid}
      LEFT JOIN units u         ON u.id  = mb.unit_id    AND u.company_id  = ${cid}
      LEFT JOIN properties p    ON p.id  = u.property_id AND p.company_id  = ${cid}
      WHERE n.company_id = ${cid}
        AND n.archived_at IS ${showArchived ? db`NOT NULL` : db`NULL`}
        ${status ? db`AND n.status = ${status}` : db``}
        ${propFilter ? db`AND (p.id = ANY(${propFilter as any}) OR p.id IS NULL)` : db``}
      ORDER BY n.created_at DESC
      LIMIT ${parseInt(limit as string)}
    `;
  });

  res.json({ success: true, data: { notifications } } satisfies ApiResponse<unknown>);
});

// ─── POST /notifications/archive-all — archive all notifications for company ──

notificationsRouter.post('/archive-all', async (req: Request, res: Response) => {
  const c   = ctx(req);
  const cid = c.companyId;

  const result = await withRLS(c, async (db) => db`
    UPDATE notifications SET archived_at = NOW()
    WHERE company_id = ${cid} AND archived_at IS NULL
    RETURNING id
  `);

  res.json({ success: true, data: { archived: result.length } } satisfies ApiResponse<unknown>);
});

// ─── POST /notifications/:id/archive — archive a notification ─────────────────

notificationsRouter.post('/:id/archive', async (req: Request, res: Response) => {
  const { id } = req.params;
  const c   = ctx(req);
  const cid = c.companyId;

  await withRLS(c, async (db) => db`
    UPDATE notifications SET archived_at = NOW()
    WHERE id = ${id} AND company_id = ${cid} AND archived_at IS NULL
  `);

  res.json({ success: true, data: { archived: true } } satisfies ApiResponse<unknown>);
});

// ─── POST /notifications/send-reminder — send bill reminder to one tenant ─────

notificationsRouter.post('/send-reminder', async (req: Request, res: Response) => {
  const { billId } = z.object({ billId: z.string().uuid() }).parse(req.body);
  const c   = ctx(req);
  const cid = c.companyId;

  await withRLSTransaction(c, async (tx: any) => {
    const [bill] = await tx`
      SELECT
        mb.id, mb.for_month, mb.due_date, mb.total_due, mb.total_amount,
        mb.snap_paybill_number, mb.snap_account_reference,
        t.id AS tenant_id, t.full_name AS tenant_name, t.phone AS tenant_phone,
        t.notify_sms,
        u.unit_number,
        l.status AS lease_status
      FROM monthly_bills mb
      JOIN leases l  ON l.id = mb.lease_id  AND l.company_id  = ${cid} AND l.deleted_at IS NULL
      JOIN tenants t ON t.id = l.primary_tenant_id AND t.company_id = ${cid} AND t.deleted_at IS NULL
      JOIN units u   ON u.id = mb.unit_id   AND u.company_id  = ${cid}
      WHERE mb.id = ${billId}
        AND mb.company_id = ${cid}
        AND mb.status IN ('open','partial','overdue')
    `;

    if (!bill) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Bill not found or already paid' } });
      return;
    }

    if (!bill.tenant_phone || !(bill.notify_sms)) {
      res.status(400).json({ success: false, error: { code: 'NO_SMS', message: 'Tenant has no phone or has disabled SMS notifications' } });
      return;
    }

    // Terminated/expired tenants only get SMS if they still owe money
    const isTerminated = ['terminated', 'expired'].includes(bill.lease_status);
    if (isTerminated && parseFloat(bill.total_due) <= 0) {
      res.status(400).json({ success: false, error: { code: 'NO_BALANCE', message: 'Tenant lease is terminated and has no outstanding balance — SMS not sent' } });
      return;
    }
    if (bill.lease_status === 'draft') {
      res.status(400).json({ success: false, error: { code: 'DRAFT_LEASE', message: 'Cannot send SMS for a draft lease' } });
      return;
    }

    const message = await buildRentReminderMessage(cid, {
      tenantName:    bill.tenant_name,
      unitNumber:    bill.unit_number,
      amount:        parseFloat(bill.total_due),
      forMonth:      bill.for_month,
      dueDate:       bill.due_date,
      paybillNumber: bill.snap_paybill_number,
      accountRef:    bill.snap_account_reference,
    });

    const notifId = randomUUID();
    await tx`
      INSERT INTO notifications (
        id, company_id, tenant_id, bill_id,
        channel, recipient, body, status,
        attempt_count, next_attempt_at
      ) VALUES (
        ${notifId}, ${cid}, ${bill.tenant_id}, ${billId},
        'sms', ${bill.tenant_phone}, ${message}, 'queued',
        0, NOW()
      )
    `;

    const result = await sendSms(bill.tenant_phone, message);

    await tx`
      UPDATE notifications SET
        status          = ${result.success ? 'sent' : 'failed'},
        sent_at         = ${result.success ? new Date() : null},
        attempt_count   = 1,
        last_attempt_at = NOW(),
        at_message_id   = ${result.messageId ?? null},
        at_error        = ${result.error ?? null}
      WHERE id = ${notifId} AND company_id = ${cid}
    `;

    res.json({
      success: true,
      data: { sent: result.success, messageId: result.messageId, message },
    } satisfies ApiResponse<unknown>);
  });
});

// ─── POST /notifications/blast — send reminder to ALL unpaid bills ─────────────

notificationsRouter.post('/blast', async (req: Request, res: Response) => {
  const c     = ctx(req);
  const cid   = c.companyId;
  const force = req.body?.force === true;

  const bills = await withRLS(c, async (db) => {
    return db`
      SELECT
        mb.id, mb.for_month, mb.due_date, mb.total_due,
        mb.snap_paybill_number, mb.snap_account_reference,
        t.id AS tenant_id, t.full_name AS tenant_name, t.phone AS tenant_phone,
        t.notify_sms,
        u.unit_number,
        l.status AS lease_status
      FROM monthly_bills mb
      JOIN leases l  ON l.id = mb.lease_id  AND l.company_id  = ${cid} AND l.deleted_at IS NULL
      JOIN tenants t ON t.id = l.primary_tenant_id AND t.company_id = ${cid} AND t.deleted_at IS NULL
      JOIN units u   ON u.id = mb.unit_id   AND u.company_id  = ${cid}
      WHERE mb.company_id = ${cid}
        AND mb.status IN ('open','partial','overdue')
        AND t.phone IS NOT NULL
        AND t.notify_sms = TRUE
        AND l.status != 'draft'
        AND (
          l.status IN ('active', 'notice')
          OR (l.status IN ('terminated', 'expired') AND mb.total_due > 0)
        )
          ${!force ? db`AND NOT EXISTS (
          SELECT 1 FROM notifications n2
          WHERE n2.bill_id    = mb.id
            AND n2.company_id = ${cid}
            AND n2.channel    = 'sms'
            AND n2.status     = 'sent'
            AND n2.sent_at    > NOW() - INTERVAL '24 hours'
        )` : db``}
    `;
  });

  // Check if there were recent sends (to warn user) when not forced
  if (!force) {
    const [recentCount] = await withRLS(c, async (db) => db`
      SELECT COUNT(*) AS count FROM notifications n
      WHERE n.company_id = ${cid}
        AND n.channel    = 'sms'
        AND n.status     = 'sent'
        AND n.sent_at    > NOW() - INTERVAL '24 hours'
    `);
    if (Number(recentCount?.count ?? 0) > 0) {
      res.status(200).json({
        success: true,
        data: {
          warn: true,
          recentCount: Number(recentCount.count),
          message: `${recentCount.count} reminder(s) were already sent in the last 24 hours. Send again anyway?`,
        },
      });
      return;
    }
  }

  let sent = 0; let failed = 0; let skipped = 0;

  for (const bill of bills) {
    if (!bill.tenant_phone) { skipped++; continue; }

    const message = await buildRentReminderMessage(cid, {
      tenantName:    bill.tenant_name,
      unitNumber:    bill.unit_number,
      amount:        parseFloat(bill.total_due),
      forMonth:      bill.for_month,
      dueDate:       bill.due_date,
      paybillNumber: bill.snap_paybill_number,
      accountRef:    bill.snap_account_reference,
    });

    const result = await sendSms(bill.tenant_phone, message);

    await withRLS(c, async (db) => {
      return db`
        INSERT INTO notifications (
          company_id, tenant_id, bill_id, channel, recipient, body, status,
          attempt_count, last_attempt_at, sent_at, at_message_id, at_error
        ) VALUES (
          ${cid}, ${bill.tenant_id}, ${bill.id}, 'sms',
          ${bill.tenant_phone}, ${message},
          ${result.success ? 'sent' : 'failed'},
          1, NOW(),
          ${result.success ? new Date() : null},
          ${result.messageId ?? null},
          ${result.error ?? null}
        )
      `;
    });

    result.success ? sent++ : failed++;
    await new Promise(r => setTimeout(r, 100));
  }

  logger.info({ companyId: cid, sent, failed, skipped }, 'SMS blast completed');
  res.json({ success: true, data: { sent, failed, skipped, total: bills.length } } satisfies ApiResponse<unknown>);
});

// ─── POST /notifications/confirm-payment ──────────────────────────────────────

notificationsRouter.post('/confirm-payment', async (req: Request, res: Response) => {
  const { paymentId } = z.object({ paymentId: z.string().uuid() }).parse(req.body);
  const c   = ctx(req);
  const cid = c.companyId;

  const [payment] = await withRLS(c, async (db) => {
    return db`
      SELECT
        p.amount, p.receipt_number,
        mb.for_month,
        t.full_name AS tenant_name, t.phone AS tenant_phone, t.notify_sms,
        t.id AS tenant_id
      FROM payments p
      JOIN monthly_bills mb ON mb.id = p.bill_id    AND mb.company_id = ${cid}
      JOIN leases l         ON l.id  = p.lease_id   AND l.company_id  = ${cid}
      JOIN tenants t        ON t.id  = l.primary_tenant_id AND t.company_id = ${cid}
      WHERE p.id = ${paymentId}
        AND p.company_id = ${cid}
        AND p.undone_at IS NULL
    `;
  });

  if (!payment || !payment.tenant_phone || !payment.notify_sms) {
    res.json({ success: true, data: { sent: false, reason: 'No phone or notifications disabled' } });
    return;
  }

  const message = await buildPaymentConfirmationMessage(cid, {
    tenantName:    payment.tenant_name,
    amount:        parseFloat(payment.amount),
    forMonth:      payment.for_month,
    receiptNumber: payment.receipt_number,
  });

  const result = await sendSms(payment.tenant_phone, message);

  await withRLS(c, async (db) => {
    return db`
      INSERT INTO notifications (
        company_id, tenant_id, channel, recipient, body, status,
        attempt_count, last_attempt_at, sent_at, at_message_id, at_error
      ) VALUES (
        ${cid}, ${payment.tenant_id}, 'sms',
        ${payment.tenant_phone}, ${message},
        ${result.success ? 'sent' : 'failed'},
        1, NOW(),
        ${result.success ? new Date() : null},
        ${result.messageId ?? null},
        ${result.error ?? null}
      )
    `;
  });

  res.json({ success: true, data: { sent: result.success, message } } satisfies ApiResponse<unknown>);
});

// ─── POST /notifications/test-sms ─────────────────────────────────────────────

notificationsRouter.post('/test-sms', async (req: Request, res: Response) => {
  const c   = ctx(req);
  const cid = c.companyId;
  const { phone, message } = z.object({
    phone:   z.string().min(5),
    message: z.string().min(1).max(160).default('PropManager test SMS — your Africa\'s Talking integration is working! ✓'),
  }).parse(req.body);

  const result = await sendSms(phone, message);

  await withRLS(c, async (db) => db`
    INSERT INTO notifications (
      company_id, channel, recipient, body, status,
      sent_at, at_message_id, at_error, attempt_count
    ) VALUES (
      ${cid}, 'sms', ${phone}, ${message},
      ${result.success ? 'sent' : 'failed'},
      ${result.success ? new Date() : null},
      ${result.messageId ?? null},
      ${result.error ?? null},
      1
    )
  `).catch(() => {});

  res.json({
    success: result.success,
    data: {
      phone,
      sent:        result.success,
      messageId:   result.messageId ?? null,
      status:      result.status    ?? null,
      error:       result.error     ?? null,
      environment: process.env.AT_ENVIRONMENT ?? 'sandbox',
    },
  });
});

// ─── In-App Alerts ────────────────────────────────────────────────────────────

notificationsRouter.get('/in-app', async (req: Request, res: Response) => {
  const c   = ctx(req);
  const { limit = '50' } = req.query;

  const items = await withRLS(c, async (db) => db`
    SELECT * FROM inapp_alerts
    WHERE company_id = ${c.companyId}
      AND user_id    = ${c.userId}
    ORDER BY created_at DESC
    LIMIT ${parseInt(limit as string)}
  `);

  const unread = items.filter((n: any) => !n.read_at).length;
  res.json({ success: true, data: { items, unread } } satisfies ApiResponse<unknown>);
});

notificationsRouter.post('/in-app/mark-read', async (req: Request, res: Response) => {
  const c = ctx(req);
  const { id } = z.object({ id: z.string().uuid().optional() }).parse(req.body);

  if (id) {
    await withRLS(c, async (db) => db`
      UPDATE inapp_alerts SET read_at = NOW()
      WHERE id = ${id} AND user_id = ${c.userId} AND company_id = ${c.companyId} AND read_at IS NULL
    `);
  } else {
    await withRLS(c, async (db) => db`
      UPDATE inapp_alerts SET read_at = NOW()
      WHERE user_id = ${c.userId} AND company_id = ${c.companyId} AND read_at IS NULL
    `);
  }

  res.json({ success: true, data: { marked: true } } satisfies ApiResponse<unknown>);
});

notificationsRouter.post('/in-app', async (req: Request, res: Response) => {
  const c    = ctx(req);
  const body = z.object({
    user_id: z.string().uuid(),
    type:    z.string().min(1),
    title:   z.string().min(1),
    body:    z.string().min(1),
    link:    z.string().optional(),
  }).parse(req.body);

  const [notif] = await withRLS(c, async (db) => db`
    INSERT INTO inapp_alerts (company_id, user_id, type, title, body, link)
    VALUES (${c.companyId}, ${body.user_id}, ${body.type}, ${body.title}, ${body.body}, ${body.link ?? null})
    RETURNING *
  `);

  res.status(201).json({ success: true, data: { notification: notif } } satisfies ApiResponse<unknown>);
});

// ─── POST /notifications/:id/retry ────────────────────────────────────────────

notificationsRouter.post('/:id/retry', async (req: Request, res: Response) => {
  const { id } = req.params;
  const c   = ctx(req);
  const cid = c.companyId;

  const [notif] = await withRLS(c, async (db) => db`
    SELECT n.*, t.phone AS tenant_phone
    FROM notifications n
    LEFT JOIN tenants t ON t.id = n.tenant_id AND t.company_id = ${cid}
    WHERE n.id = ${id}
      AND n.company_id = ${cid}
      AND n.status = 'failed'
  `);

  if (!notif) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Notification not found or not in failed state' } });
    return;
  }

  const result = await sendSms(notif.recipient, notif.body);

  await withRLS(c, async (db) => db`
    UPDATE notifications SET
      status          = ${result.success ? 'sent' : 'failed'},
      sent_at         = ${result.success ? new Date() : null},
      attempt_count   = attempt_count + 1,
      last_attempt_at = NOW(),
      at_message_id   = ${result.messageId ?? null},
      at_error        = ${result.error ?? null}
    WHERE id = ${id} AND company_id = ${cid}
  `);

  res.json({ success: true, data: { sent: result.success } } satisfies ApiResponse<unknown>);
});