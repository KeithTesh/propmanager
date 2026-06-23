// api/src/modules/landlord-portal/landlord-portal.router.ts
//
// Read-only portal for landlord clients (role = landlord_client).
// All routes require role = landlord_client.
// Data scoped to the landlord record linked to the logged-in user.
// Landlords cannot see tenant names — only unit numbers.
// Notes only shown if notes_visible_to_landlord = TRUE.

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { sql } from '../../db';
import { authenticate } from '../../middleware/auth';
import { ForbiddenError, NotFoundError } from '../../lib/errors';
import type { ApiResponse } from '../../types';

export const landlordPortalRouter = Router();
landlordPortalRouter.use(authenticate);

// ─── Guard: landlord_client role only ────────────────────────────────────────

function landlordOnly(req: Request) {
  if (req.ctx.userRole !== 'landlord_client') {
    throw new ForbiddenError('This endpoint is only accessible to landlord clients.');
  }
}

// Resolve the landlord record from the logged-in user
async function getLandlord(userId: string) {
  const [landlord] = await sql`
    SELECT l.*, co.name AS agent_company_name, co.phone AS agent_phone, co.email AS agent_email
    FROM landlords l
    JOIN companies co ON co.id = l.company_id
    WHERE l.user_id = ${userId} AND l.deleted_at IS NULL
  `;
  if (!landlord) throw new NotFoundError('Landlord account not found.');
  return landlord;
}

// ─── GET /landlord-portal/me ──────────────────────────────────────────────────

landlordPortalRouter.get('/me', async (req: Request, res: Response) => {
  landlordOnly(req);
  const landlord = await getLandlord(req.ctx.userId);

  res.json({
    success: true,
    data: {
      landlord: {
        id:           landlord.id,
        fullName:     landlord.full_name,
        phone:        landlord.phone,
        email:        landlord.email,
        bankName:     landlord.bank_name,
        bankAccount:  landlord.bank_account,
        commissionType:  landlord.commission_type,
        commissionValue: Number(landlord.commission_value),
      },
      agent: {
        name:  landlord.agent_company_name,
        phone: landlord.agent_phone,
        email: landlord.agent_email,
      },
    },
  } satisfies ApiResponse<unknown>);
});

// ─── GET /landlord-portal/properties ─────────────────────────────────────────

landlordPortalRouter.get('/properties', async (req: Request, res: Response) => {
  landlordOnly(req);
  const landlord = await getLandlord(req.ctx.userId);

  const properties = await sql`
    SELECT
      p.id, p.name, p.address, p.county,
      COUNT(DISTINCT u.id)                                        AS unit_count,
      COUNT(DISTINCT u.id) FILTER (WHERE lse.status = 'active')  AS occupied_units,
      COUNT(DISTINCT u.id) FILTER (
        WHERE lse.status IS NULL OR lse.status NOT IN ('active','notice')
      )                                                           AS vacant_units,
      ROUND(
        COUNT(DISTINCT u.id) FILTER (WHERE lse.status = 'active')::numeric /
        NULLIF(COUNT(DISTINCT u.id), 0) * 100, 1
      )                                                           AS occupancy_rate
    FROM properties p
    LEFT JOIN units u    ON u.property_id = p.id AND u.deleted_at IS NULL
    LEFT JOIN leases lse ON lse.unit_id = u.id AND lse.status IN ('active','notice')
    WHERE p.landlord_id = ${landlord.id}
      AND p.company_id  = ${landlord.company_id}
      AND p.deleted_at IS NULL
    GROUP BY p.id
    ORDER BY p.name ASC
  `;

  res.json({ success: true, data: { properties } } satisfies ApiResponse<unknown>);
});

// ─── GET /landlord-portal/collections ────────────────────────────────────────

landlordPortalRouter.get('/collections', async (req: Request, res: Response) => {
  landlordOnly(req);
  const landlord = await getLandlord(req.ctx.userId);

  // Month from query param, default to current month
  const monthParam = req.query.month as string | undefined;
  const month = monthParam
    ? new Date(monthParam).toISOString().slice(0, 10)
    : new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);

  const collections = await sql`
    SELECT
      p.id          AS property_id,
      p.name        AS property_name,
      COUNT(DISTINCT u.id)                                           AS unit_count,
      COUNT(DISTINCT u.id) FILTER (WHERE lse.status = 'active')     AS occupied_units,
      COALESCE(SUM(b.amount), 0)                                     AS total_billed,
      COALESCE(SUM(pay.amount) FILTER (WHERE pay.status='confirmed'),0) AS total_collected,
      COALESCE(SUM(b.amount) - SUM(pay.amount) FILTER (WHERE pay.status='confirmed'), 0)
                                                                     AS outstanding,
      ROUND(
        COALESCE(SUM(pay.amount) FILTER (WHERE pay.status='confirmed'), 0) /
        NULLIF(SUM(b.amount), 0) * 100, 1
      )                                                              AS collection_rate
    FROM properties p
    LEFT JOIN units u    ON u.property_id = p.id AND u.deleted_at IS NULL
    LEFT JOIN leases lse ON lse.unit_id = u.id AND lse.status = 'active'
    LEFT JOIN monthly_bills b ON b.lease_id = lse.id
      AND DATE_TRUNC('month', b.due_date) = ${month}::date
    LEFT JOIN payments pay ON pay.bill_id = b.id
      AND pay.company_id = ${landlord.company_id}
    WHERE p.landlord_id = ${landlord.id}
      AND p.company_id  = ${landlord.company_id}
      AND p.deleted_at IS NULL
    GROUP BY p.id
    ORDER BY p.name ASC
  `;

  // Month summary
  const totals = collections.reduce((acc: any, r: any) => ({
    totalBilled:    acc.totalBilled    + Number(r.total_billed),
    totalCollected: acc.totalCollected + Number(r.total_collected),
    outstanding:    acc.outstanding    + Number(r.outstanding),
  }), { totalBilled: 0, totalCollected: 0, outstanding: 0 });

  res.json({
    success: true,
    data: { month, collections, totals },
  } satisfies ApiResponse<unknown>);
});

// ─── GET /landlord-portal/statements ─────────────────────────────────────────

landlordPortalRouter.get('/statements', async (req: Request, res: Response) => {
  landlordOnly(req);
  const landlord = await getLandlord(req.ctx.userId);

  // Only show sent or paid statements — not drafts
  const statements = await sql`
    SELECT
      rs.id, rs.period_month, rs.status,
      rs.gross_collected, rs.commission_amount, rs.expenses_deducted, rs.net_payable,
      rs.dispute_flag, rs.sent_at, rs.paid_at, rs.payment_reference,
      rs.notes_visible_to_landlord,
      CASE WHEN rs.notes_visible_to_landlord THEN rs.notes ELSE NULL END AS notes,
      -- Dispute info if exists
      rd.status   AS dispute_status,
      rd.reason   AS dispute_reason,
      rd.agent_response
    FROM remittance_statements rs
    LEFT JOIN remittance_disputes rd ON rd.statement_id = rs.id
      AND rd.status != 'resolved'
    WHERE rs.landlord_id = ${landlord.id}
      AND rs.status IN ('sent','paid')
    ORDER BY rs.period_month DESC
  `;

  res.json({ success: true, data: { statements } } satisfies ApiResponse<unknown>);
});

// ─── GET /landlord-portal/statements/:id ─────────────────────────────────────

landlordPortalRouter.get('/statements/:id', async (req: Request, res: Response) => {
  landlordOnly(req);
  const landlord = await getLandlord(req.ctx.userId);
  const { id } = req.params;

  const [statement] = await sql`
    SELECT
      rs.*,
      CASE WHEN rs.notes_visible_to_landlord THEN rs.notes ELSE NULL END AS notes,
      co.name AS agent_name
    FROM remittance_statements rs
    JOIN companies co ON co.id = rs.company_id
    WHERE rs.id = ${id}
      AND rs.landlord_id = ${landlord.id}
      AND rs.status IN ('sent','paid')
  `;
  if (!statement) throw new NotFoundError('Statement not found or not yet available.');

  const lines = await sql`
    SELECT
      property_name,
      unit_count, occupied_units,
      amount_billed, amount_collected,
      commission_type, commission_rate, commission_amount,
      expenses_amount, net_amount,
      notes
    FROM remittance_statement_lines
    WHERE statement_id = ${id}
    ORDER BY property_name ASC
  `;

  const [dispute] = await sql`
    SELECT reason, status, agent_response, created_at, resolved_at
    FROM remittance_disputes
    WHERE statement_id = ${id}
    ORDER BY created_at DESC LIMIT 1
  `;

  res.json({
    success: true,
    data: { statement, lines, dispute: dispute ?? null },
  } satisfies ApiResponse<unknown>);
});

// ─── POST /landlord-portal/statements/:id/dispute ────────────────────────────

landlordPortalRouter.post('/statements/:id/dispute', async (req: Request, res: Response) => {
  landlordOnly(req);
  const landlord = await getLandlord(req.ctx.userId);
  const { id } = req.params;
  const { reason } = z.object({
    reason: z.string().min(10, 'Please provide at least 10 characters explaining the issue.'),
  }).parse(req.body);

  // Verify statement belongs to this landlord
  const [statement] = await sql`
    SELECT id, status, dispute_flag
    FROM remittance_statements
    WHERE id = ${id} AND landlord_id = ${landlord.id} AND status IN ('sent','paid')
  `;
  if (!statement) throw new NotFoundError('Statement not found.');

  if (statement.dispute_flag) {
    res.status(409).json({
      success: false,
      error: { code: 'DISPUTE_EXISTS', message: 'There is already an open dispute on this statement.' },
    });
    return;
  }

  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO remittance_disputes (statement_id, landlord_id, reason, status)
      VALUES (${id}, ${landlord.id}, ${reason}, 'open')
    `;
    await tx`
      UPDATE remittance_statements SET dispute_flag = TRUE, updated_at = NOW()
      WHERE id = ${id}
    `;
  });

  // Notify agent owner
  const { sendSms } = await import('../../lib/sms');
  const [agentOwner] = await sql`
    SELECT u.phone FROM users u
    WHERE u.company_id = ${landlord.company_id}
      AND u.role = 'owner' AND u.is_active = TRUE
    LIMIT 1
  `;
  if (agentOwner?.phone) {
    const month = new Date((await sql`
      SELECT period_month FROM remittance_statements WHERE id = ${id}
    `)[0].period_month).toLocaleString('en-KE', { month: 'long', year: 'numeric' });
    sendSms(
      agentOwner.phone,
      `PropManager: ${landlord.full_name} has flagged their ${month} statement as incorrect. ` +
      `Review in your Remittances dashboard.`
    ).catch(() => {});
  }

  res.status(201).json({
    success: true,
    data: { message: 'Dispute raised. Your agent will respond within 2 business days.' },
  } satisfies ApiResponse<unknown>);
});

// ─── GET /landlord-portal/overview ───────────────────────────────────────────

landlordPortalRouter.get('/overview', async (req: Request, res: Response) => {
  landlordOnly(req);
  const landlord = await getLandlord(req.ctx.userId);

  // Property + unit summary
  const [portfolioStats] = await sql`
    SELECT
      COUNT(DISTINCT p.id)                                        AS property_count,
      COUNT(DISTINCT u.id)                                        AS unit_count,
      COUNT(DISTINCT u.id) FILTER (WHERE lse.status = 'active')  AS occupied_units,
      ROUND(
        COUNT(DISTINCT u.id) FILTER (WHERE lse.status = 'active')::numeric /
        NULLIF(COUNT(DISTINCT u.id), 0) * 100, 1
      )                                                           AS occupancy_rate
    FROM properties p
    LEFT JOIN units u    ON u.property_id = p.id AND u.deleted_at IS NULL
    LEFT JOIN leases lse ON lse.unit_id = u.id AND lse.status = 'active'
    WHERE p.landlord_id = ${landlord.id}
      AND p.company_id  = ${landlord.company_id}
      AND p.deleted_at IS NULL
  `;

  // This month collections
  const [monthCollections] = await sql`
    SELECT
      COALESCE(SUM(b.amount), 0)                                       AS total_billed,
      COALESCE(SUM(pay.amount) FILTER (WHERE pay.status='confirmed'),0) AS total_collected
    FROM properties p
    JOIN units u    ON u.property_id = p.id AND u.deleted_at IS NULL
    JOIN leases lse ON lse.unit_id = u.id AND lse.status = 'active'
    JOIN monthly_bills b ON b.lease_id = lse.id
      AND DATE_TRUNC('month', b.due_date) = DATE_TRUNC('month', NOW())
    LEFT JOIN payments pay ON pay.bill_id = b.id
      AND pay.company_id = ${landlord.company_id}
    WHERE p.landlord_id = ${landlord.id}
      AND p.company_id  = ${landlord.company_id}
      AND p.deleted_at IS NULL
  `;

  // Last remittance statement
  const [lastStatement] = await sql`
    SELECT id, period_month, net_payable, status, paid_at, dispute_flag
    FROM remittance_statements
    WHERE landlord_id = ${landlord.id} AND status IN ('sent','paid')
    ORDER BY period_month DESC
    LIMIT 1
  `;

  // Open disputes count
  const [disputeCount] = await sql`
    SELECT COUNT(*) AS count
    FROM remittance_disputes rd
    JOIN remittance_statements rs ON rs.id = rd.statement_id
    WHERE rs.landlord_id = ${landlord.id} AND rd.status = 'open'
  `;

  res.json({
    success: true,
    data: {
      portfolio: portfolioStats,
      thisMonth: monthCollections,
      lastStatement: lastStatement ?? null,
      openDisputeCount: Number(disputeCount?.count ?? 0),
    },
  } satisfies ApiResponse<unknown>);
});