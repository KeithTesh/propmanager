// api/src/modules/remittances/remittances.router.ts

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import type postgres from 'postgres';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { sql, withRLS } from '../../db';
import { authenticate } from '../../middleware/auth';
import { NotFoundError, ForbiddenError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { sendSms } from '../../lib/sms';
import type { ApiResponse, RLSContext } from '../../types';

export const remittancesRouter = Router();
remittancesRouter.use(authenticate);

const execFileAsync = promisify(execFile);

function ctx(req: Request): RLSContext {
  return { companyId: req.ctx.companyId!, userId: req.ctx.userId, userRole: req.ctx.userRole };
}

async function requireAgent(req: Request) {
  const [co] = await sql`SELECT account_type FROM companies WHERE id = ${req.ctx.companyId!} AND deleted_at IS NULL`;
  if (co?.account_type !== 'agent') throw new ForbiddenError('Only agent accounts can use remittances.');
}

function requireViewRole(req: Request) {
  if (!['owner','manager','accountant'].includes(req.ctx.userRole))
    throw new ForbiddenError('Access denied.');
}

function requireEditRole(req: Request) {
  if (!['owner','accountant'].includes(req.ctx.userRole))
    throw new ForbiddenError('Only owner or accountant can manage remittances.');
}

// ── Commission calculation helper ─────────────────────────────────────────────
// Hierarchy: property override → landlord rate → company default

async function getCommissionRate(
  companyId: string,
  landlordId: string,
  propertyId: string
): Promise<{ type: string; value: number; source: string }> {
  // 1. Property override
  const [override] = await sql`
    SELECT commission_type, commission_value FROM commission_overrides
    WHERE landlord_id = ${landlordId} AND property_id = ${propertyId}
  `;
  if (override) return { type: override.commission_type, value: Number(override.commission_value), source: 'property_override' };

  // 2. Landlord rate
  const [landlord] = await sql`
    SELECT commission_type, commission_value FROM landlords
    WHERE id = ${landlordId} AND company_id = ${companyId} AND deleted_at IS NULL
  `;
  if (landlord) return { type: landlord.commission_type, value: Number(landlord.commission_value), source: 'landlord_rate' };

  // 3. Company default
  const [company] = await sql`
    SELECT default_commission_type, default_commission_value FROM companies WHERE id = ${companyId}
  `;
  return {
    type:   company?.default_commission_type  ?? 'percentage',
    value:  Number(company?.default_commission_value ?? 10),
    source: 'company_default',
  };
}

function calcCommission(collected: number, type: string, value: number): number {
  if (type === 'percentage') return Math.round((collected * value / 100) * 100) / 100;
  return value; // flat fee always charged
}

// ── GET /remittances ──────────────────────────────────────────────────────────

remittancesRouter.get('/', async (req: Request, res: Response) => {
  await requireAgent(req);
  requireViewRole(req);
  const c = ctx(req);
  const { landlordId, status } = req.query as Record<string, string | undefined>;

  const statements = await withRLS(c, async (db) => db`
    SELECT
      rs.id, rs.landlord_id, rs.period_month, rs.status,
      rs.gross_collected, rs.commission_amount, rs.expenses_deducted, rs.net_payable,
      rs.dispute_flag, rs.notes_visible_to_landlord,
      rs.sent_at, rs.paid_at, rs.created_at,
      l.full_name AS landlord_name
    FROM remittance_statements rs
    JOIN landlords l ON l.id = rs.landlord_id
    WHERE rs.company_id = ${c.companyId}
      AND (${landlordId ?? null}::uuid IS NULL OR rs.landlord_id = ${landlordId ?? null}::uuid)
      AND (${status ?? null}::text IS NULL OR rs.status = ${status ?? null}::text)
    ORDER BY rs.period_month DESC, l.full_name ASC
  `);

  res.json({ success: true, data: { statements } } satisfies ApiResponse<unknown>);
});

// ── GET /remittances/:id ──────────────────────────────────────────────────────

remittancesRouter.get('/:id', async (req: Request, res: Response) => {
  await requireAgent(req);
  requireViewRole(req);
  const c = ctx(req);
  const { id } = req.params;

  const [statement] = await withRLS(c, async (db) => db`
    SELECT rs.*, l.full_name AS landlord_name, l.bank_name, l.bank_account,
           l.phone AS landlord_phone, l.email AS landlord_email
    FROM remittance_statements rs
    JOIN landlords l ON l.id = rs.landlord_id
    WHERE rs.id = ${id} AND rs.company_id = ${c.companyId}
  `);
  if (!statement) throw new NotFoundError('Statement not found');

  const lines = await withRLS(c, async (db) => db`
    SELECT * FROM remittance_statement_lines
    WHERE statement_id = ${id}
    ORDER BY property_name ASC
  `);

  // Dispute if any
  const [dispute] = await withRLS(c, async (db) => db`
    SELECT * FROM remittance_disputes WHERE statement_id = ${id} ORDER BY created_at DESC LIMIT 1
  `);

  res.json({ success: true, data: { statement, lines, dispute: dispute ?? null } } satisfies ApiResponse<unknown>);
});

// ── POST /remittances/generate — preview calculation ─────────────────────────

remittancesRouter.post('/generate', async (req: Request, res: Response) => {
  await requireAgent(req);
  requireEditRole(req);
  const c = ctx(req);

  const { landlordId, periodMonth } = z.object({
    landlordId:  z.string().uuid(),
    periodMonth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format (first of month)'),
  }).parse(req.body);

  // Verify landlord belongs to this company
  const [landlord] = await withRLS(c, async (db) => db`
    SELECT id, full_name, commission_type, commission_value
    FROM landlords WHERE id = ${landlordId} AND company_id = ${c.companyId} AND deleted_at IS NULL
  `);
  if (!landlord) throw new NotFoundError('Landlord client not found');

  // Check no existing statement for this period
  const [existing] = await withRLS(c, async (db) => db`
    SELECT id, status FROM remittance_statements
    WHERE company_id = ${c.companyId} AND landlord_id = ${landlordId}
      AND period_month = ${periodMonth}::date
  `);
  if (existing) {
    res.status(409).json({
      success: false,
      error: {
        code: 'STATEMENT_EXISTS',
        message: `A ${existing.status} statement already exists for this landlord and month.`,
        statementId: existing.id,
      },
    });
    return;
  }

  // Get all properties assigned to this landlord
  const properties = await withRLS(c, async (db) => db`
    SELECT p.id, p.name,
      COUNT(DISTINCT u.id)                                        AS unit_count,
      COUNT(DISTINCT u.id) FILTER (WHERE lse.status = 'active')  AS occupied_units
    FROM properties p
    LEFT JOIN units u    ON u.property_id = p.id AND u.deleted_at IS NULL
    LEFT JOIN leases lse ON lse.unit_id = u.id AND lse.status = 'active'
    WHERE p.landlord_id = ${landlordId} AND p.company_id = ${c.companyId} AND p.deleted_at IS NULL
    GROUP BY p.id
  `);

  if (properties.length === 0) {
    res.status(400).json({
      success: false,
      error: { message: 'This landlord has no properties assigned. Assign at least one property first.' },
    });
    return;
  }

  // Build line items
  const lines: any[] = [];
  let totalGross = 0;
  let totalCommission = 0;
  let totalExpenses = 0;

  for (const prop of properties) {
    // Rent collected this month for this property
    const [collections] = await withRLS(c, async (db) => db`
      SELECT
        COALESCE(SUM(b.amount), 0)              AS billed,
        COALESCE(SUM(pay.amount) FILTER (
          WHERE pay.status = 'confirmed'
        ), 0)                                   AS collected
      FROM units u
      JOIN leases lse      ON lse.unit_id = u.id
      JOIN monthly_bills b ON b.lease_id = lse.id
        AND DATE_TRUNC('month', b.due_date) = ${periodMonth}::date
      LEFT JOIN payments pay ON pay.bill_id = b.id AND pay.company_id = ${c.companyId}
      WHERE u.property_id = ${prop.id} AND u.deleted_at IS NULL
    `);

    // Approved expenses for this property this month
    const [expenseRow] = await withRLS(c, async (db) => db`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM expenses
      WHERE property_id = ${prop.id}
        AND company_id = ${c.companyId}
        AND status = 'approved'
        AND DATE_TRUNC('month', expense_date) = ${periodMonth}::date
    `);

    const collected  = Number(collections?.collected ?? 0);
    const billed     = Number(collections?.billed    ?? 0);
    const expenses   = Number(expenseRow?.total       ?? 0);

    const commRate   = await getCommissionRate(c.companyId, landlordId, prop.id);
    const commission = calcCommission(collected, commRate.type, commRate.value);
    const net        = collected - commission - expenses;

    lines.push({
      propertyId:       prop.id,
      propertyName:     prop.name,
      unitCount:        Number(prop.unit_count),
      occupiedUnits:    Number(prop.occupied_units),
      amountBilled:     billed,
      amountCollected:  collected,
      commissionType:   commRate.type,
      commissionRate:   commRate.value,
      commissionAmount: commission,
      expensesAmount:   expenses,
      netAmount:        net,
    });

    totalGross      += collected;
    totalCommission += commission;
    totalExpenses   += expenses;
  }

  const netPayable = totalGross - totalCommission - totalExpenses;

  res.json({
    success: true,
    data: {
      preview: {
        landlordId,
        landlordName:    landlord.full_name,
        periodMonth,
        grossCollected:  totalGross,
        commissionAmount: totalCommission,
        expensesDeducted: totalExpenses,
        netPayable,
        lines,
      },
    },
  } satisfies ApiResponse<unknown>);
});

// ── POST /remittances/generate/confirm — save statement ───────────────────────

remittancesRouter.post('/generate/confirm', async (req: Request, res: Response) => {
  await requireAgent(req);
  requireEditRole(req);
  const c = ctx(req);

  const body = z.object({
    landlordId:       z.string().uuid(),
    periodMonth:      z.string(),
    grossCollected:   z.number(),
    commissionAmount: z.number(),
    expensesDeducted: z.number(),
    netPayable:       z.number(),
    lines:            z.array(z.object({
      propertyId:       z.string().uuid(),
      propertyName:     z.string(),
      unitCount:        z.number(),
      occupiedUnits:    z.number(),
      amountBilled:     z.number(),
      amountCollected:  z.number(),
      commissionType:   z.string(),
      commissionRate:   z.number(),
      commissionAmount: z.number(),
      expensesAmount:   z.number(),
      netAmount:        z.number(),
    })),
  }).parse(req.body);

  const statementId = randomUUID();

  await sql.begin(async (rawTx) => {
    const tx = rawTx as unknown as postgres.Sql;
    await tx`
      INSERT INTO remittance_statements (
        id, company_id, landlord_id, period_month,
        gross_collected, commission_amount, expenses_deducted, net_payable,
        status, generated_by
      ) VALUES (
        ${statementId}, ${c.companyId}, ${body.landlordId}, ${body.periodMonth}::date,
        ${body.grossCollected}, ${body.commissionAmount},
        ${body.expensesDeducted}, ${body.netPayable},
        'draft', ${c.userId}
      )
    `;

    for (const line of body.lines) {
      await tx`
        INSERT INTO remittance_statement_lines (
          statement_id, property_id, property_name,
          unit_count, occupied_units, amount_billed, amount_collected,
          commission_type, commission_rate, commission_amount,
          expenses_amount, net_amount
        ) VALUES (
          ${statementId}, ${line.propertyId}, ${line.propertyName},
          ${line.unitCount}, ${line.occupiedUnits}, ${line.amountBilled}, ${line.amountCollected},
          ${line.commissionType}, ${line.commissionRate}, ${line.commissionAmount},
          ${line.expensesAmount}, ${line.netAmount}
        )
      `;
    }
  });

  logger.info({ statementId, companyId: c.companyId }, 'Remittance statement created');
  res.status(201).json({ success: true, data: { statementId } } satisfies ApiResponse<unknown>);
});

// ── PATCH /remittances/:id/send ───────────────────────────────────────────────

remittancesRouter.patch('/:id/send', async (req: Request, res: Response) => {
  await requireAgent(req);
  requireEditRole(req);
  const c = ctx(req);
  const { id } = req.params;
  const { notes, notesVisibleToLandlord } = z.object({
    notes:                   z.string().optional().nullable(),
    notesVisibleToLandlord:  z.boolean().default(true),
  }).parse(req.body);

  const [statement] = await withRLS(c, async (db) => db`
    SELECT rs.*, l.full_name AS landlord_name, l.phone AS landlord_phone
    FROM remittance_statements rs
    JOIN landlords l ON l.id = rs.landlord_id
    WHERE rs.id = ${id} AND rs.company_id = ${c.companyId}
  `);
  if (!statement) throw new NotFoundError('Statement not found');
  if (statement.status !== 'draft') {
    res.status(409).json({ success: false, error: { message: 'Only draft statements can be marked as sent.' } });
    return;
  }

  await withRLS(c, async (db) => db`
    UPDATE remittance_statements SET
      status                    = 'sent',
      notes                     = ${notes ?? statement.notes},
      notes_visible_to_landlord = ${notesVisibleToLandlord},
      sent_at                   = NOW(),
      updated_at                = NOW()
    WHERE id = ${id} AND company_id = ${c.companyId}
  `);

  // Get company name
  const [co] = await sql`SELECT name FROM companies WHERE id = ${c.companyId}`;

  // Notify landlord via SMS
  if (statement.landlord_phone) {
    const month = new Date(statement.period_month).toLocaleString('en-KE', { month: 'long', year: 'numeric' });
    sendSms(
      statement.landlord_phone,
      `Hi ${statement.landlord_name.split(' ')[0]}, your ${month} statement from ${co.name} is ready. ` +
      `Net payable: KES ${Number(statement.net_payable).toLocaleString()}. ` +
      `View at propmanager.co.ke/landlord-portal`
    ).catch(() => {});
  }

  logger.info({ statementId: id, companyId: c.companyId }, 'Remittance statement marked as sent');
  res.json({ success: true, data: { message: 'Statement marked as sent' } } satisfies ApiResponse<unknown>);
});

// ── PATCH /remittances/:id/paid ───────────────────────────────────────────────

remittancesRouter.patch('/:id/paid', async (req: Request, res: Response) => {
  await requireAgent(req);
  requireEditRole(req);
  const c = ctx(req);
  const { id } = req.params;
  const { paymentReference } = z.object({
    paymentReference: z.string().min(1, 'Payment reference is required'),
  }).parse(req.body);

  const [statement] = await withRLS(c, async (db) => db`
    SELECT rs.*, l.full_name AS landlord_name, l.phone AS landlord_phone
    FROM remittance_statements rs
    JOIN landlords l ON l.id = rs.landlord_id
    WHERE rs.id = ${id} AND rs.company_id = ${c.companyId}
  `);
  if (!statement) throw new NotFoundError('Statement not found');
  if (statement.status === 'paid') {
    res.status(409).json({ success: false, error: { message: 'Statement is already marked as paid.' } });
    return;
  }

  await withRLS(c, async (db) => db`
    UPDATE remittance_statements SET
      status            = 'paid',
      payment_reference = ${paymentReference},
      paid_at           = NOW(),
      updated_at        = NOW()
    WHERE id = ${id} AND company_id = ${c.companyId}
  `);

  const [co] = await sql`SELECT name FROM companies WHERE id = ${c.companyId}`;

  if (statement.landlord_phone) {
    const month = new Date(statement.period_month).toLocaleString('en-KE', { month: 'long', year: 'numeric' });
    sendSms(
      statement.landlord_phone,
      `Hi ${statement.landlord_name.split(' ')[0]}, ${co.name} has remitted KES ${Number(statement.net_payable).toLocaleString()} ` +
      `for ${month}. Ref: ${paymentReference}. PropManager`
    ).catch(() => {});
  }

  res.json({ success: true, data: { message: 'Statement marked as paid' } } satisfies ApiResponse<unknown>);
});

// ── POST /remittances/:id/dispute ─────────────────────────────────────────────

remittancesRouter.post('/:id/dispute', async (req: Request, res: Response) => {
  // Landlord_client raises a dispute — auth checked via landlord portal route
  // This can also be called by the agent on behalf (owner only)
  const c = ctx(req);
  const { id } = req.params;
  const { reason } = z.object({ reason: z.string().min(10) }).parse(req.body);

  // Find statement and verify access
  const [statement] = await sql`
    SELECT rs.id, rs.company_id, rs.landlord_id, rs.dispute_flag,
           l.user_id AS landlord_user_id, l.full_name AS landlord_name
    FROM remittance_statements rs
    JOIN landlords l ON l.id = rs.landlord_id
    WHERE rs.id = ${id}
  `;
  if (!statement) throw new NotFoundError('Statement not found');

  // Access: must be the landlord_client user OR owner of the agent company
  const isLandlordClient = req.ctx.userRole === 'landlord_client' &&
    statement.landlord_user_id === req.ctx.userId;
  const isAgentOwner = req.ctx.userRole === 'owner' &&
    statement.company_id === c.companyId;

  if (!isLandlordClient && !isAgentOwner) {
    throw new ForbiddenError('Access denied.');
  }

  // Check no open dispute already
  const [openDispute] = await sql`
    SELECT id FROM remittance_disputes
    WHERE statement_id = ${id} AND status = 'open'
  `;
  if (openDispute) {
    res.status(409).json({
      success: false,
      error: { code: 'DISPUTE_EXISTS', message: 'There is already an open dispute on this statement.' },
    });
    return;
  }

  await sql.begin(async (rawTx) => {
    const tx = rawTx as unknown as postgres.Sql;
    await tx`
      INSERT INTO remittance_disputes (statement_id, landlord_id, reason, status)
      VALUES (${id}, ${statement.landlord_id}, ${reason}, 'open')
    `;
    await tx`
      UPDATE remittance_statements SET dispute_flag = TRUE, updated_at = NOW()
      WHERE id = ${id}
    `;
  });

  // Notify agent owner via lookup
  const [agentOwner] = await sql`
    SELECT u.phone FROM users u
    WHERE u.company_id = ${statement.company_id} AND u.role = 'owner' AND u.is_active = TRUE
    LIMIT 1
  `;
  if (agentOwner?.phone) {
    sendSms(agentOwner.phone,
      `PropManager: ${statement.landlord_name} has flagged their statement as incorrect. ` +
      `Please review in your Remittances dashboard.`
    ).catch(() => {});
  }

  logger.info({ statementId: id }, 'Remittance dispute raised');
  res.status(201).json({ success: true, data: { message: 'Dispute raised. The agent will be notified.' } } satisfies ApiResponse<unknown>);
});

// ── PATCH /remittances/:id/dispute ────────────────────────────────────────────

remittancesRouter.patch('/:id/dispute', async (req: Request, res: Response) => {
  await requireAgent(req);
  requireEditRole(req);
  const c = ctx(req);
  const { id } = req.params;
  const { agentResponse, status } = z.object({
    agentResponse: z.string().min(5),
    status:        z.enum(['agent_responded','resolved']).default('agent_responded'),
  }).parse(req.body);

  const [dispute] = await sql`
    SELECT rd.*, rs.company_id FROM remittance_disputes rd
    JOIN remittance_statements rs ON rs.id = rd.statement_id
    WHERE rd.statement_id = ${id} AND rs.company_id = ${c.companyId}
    ORDER BY rd.created_at DESC LIMIT 1
  `;
  if (!dispute) throw new NotFoundError('No dispute found for this statement');

  await sql.begin(async (rawTx) => {
    const tx = rawTx as unknown as postgres.Sql;
    await tx`
      UPDATE remittance_disputes SET
        agent_response = ${agentResponse},
        status         = ${status},
        resolved_at    = ${status === 'resolved' ? new Date() : null},
        updated_at     = NOW()
      WHERE id = ${dispute.id}
    `;
    if (status === 'resolved') {
      await tx`
        UPDATE remittance_statements SET dispute_flag = FALSE, updated_at = NOW()
        WHERE id = ${id}
      `;
    }
  });

  res.json({ success: true, data: { message: 'Dispute response saved' } } satisfies ApiResponse<unknown>);
});

// ── GET /remittances/:id/pdf ──────────────────────────────────────────────────

remittancesRouter.get('/:id/pdf', async (req: Request, res: Response) => {
  const c = ctx(req);
  const { id } = req.params;

  // Allow agent roles + landlord_client
  if (!['owner','manager','accountant','landlord_client'].includes(req.ctx.userRole)) {
    throw new ForbiddenError('Access denied.');
  }

  // For landlord_client: verify they own this statement
  let statement: any;
  if (req.ctx.userRole === 'landlord_client') {
    [statement] = await sql`
      SELECT rs.*, l.full_name AS landlord_name, l.bank_name, l.bank_account,
             co.name AS company_name, co.phone AS company_phone, co.email AS company_email
      FROM remittance_statements rs
      JOIN landlords l  ON l.id = rs.landlord_id
      JOIN companies co ON co.id = rs.company_id
      WHERE rs.id = ${id} AND l.user_id = ${req.ctx.userId}
    `;
  } else {
    await requireAgent(req);
    [statement] = await withRLS(c, async (db) => db`
      SELECT rs.*, l.full_name AS landlord_name, l.bank_name, l.bank_account,
             co.name AS company_name, co.phone AS company_phone, co.email AS company_email
      FROM remittance_statements rs
      JOIN landlords l  ON l.id = rs.landlord_id
      JOIN companies co ON co.id = rs.company_id
      WHERE rs.id = ${id} AND rs.company_id = ${c.companyId}
    `);
  }
  if (!statement) throw new NotFoundError('Statement not found');

  const lines = await sql`
    SELECT * FROM remittance_statement_lines WHERE statement_id = ${id} ORDER BY property_name
  `;

  // Only include notes if visible to landlord (or agent is viewing)
  const showNotes = req.ctx.userRole !== 'landlord_client' || statement.notes_visible_to_landlord;

  const month = new Date(statement.period_month).toLocaleString('en-KE', { month: 'long', year: 'numeric' });

  const pdfData = {
    companyName:     statement.company_name,
    companyPhone:    statement.company_phone ?? '',
    companyEmail:    statement.company_email ?? '',
    landlordName:    statement.landlord_name,
    landlordBank:    statement.bank_name    ? `${statement.bank_name} — ${statement.bank_account ?? ''}` : '',
    month,
    periodMonth:     statement.period_month,
    grossCollected:  Number(statement.gross_collected),
    commissionAmount:Number(statement.commission_amount),
    expensesDeducted:Number(statement.expenses_deducted),
    netPayable:      Number(statement.net_payable),
    status:          statement.status,
    paymentRef:      statement.payment_reference ?? '',
    notes:           showNotes ? (statement.notes ?? '') : '',
    lines: lines.map((l: any) => ({
      propertyName:     l.property_name,
      unitCount:        Number(l.unit_count),
      occupiedUnits:    Number(l.occupied_units),
      amountBilled:     Number(l.amount_billed),
      amountCollected:  Number(l.amount_collected),
      commissionType:   l.commission_type,
      commissionRate:   Number(l.commission_rate),
      commissionAmount: Number(l.commission_amount),
      expensesAmount:   Number(l.expenses_amount),
      netAmount:        Number(l.net_amount),
    })),
  };

  const tmpIn  = join(tmpdir(), `remittance-${randomUUID()}.json`);
  const tmpOut = join(tmpdir(), `remittance-${randomUUID()}.pdf`);

  const PYTHON_SCRIPT = `
import sys, json
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from datetime import datetime

data = json.load(open(sys.argv[1]))
out_path = sys.argv[2]

TEAL  = colors.HexColor('#0d9f9f')
DARK  = colors.HexColor('#1a2332')
GRAY  = colors.HexColor('#6b7280')
LIGHT = colors.HexColor('#f0fafa')
RED   = colors.HexColor('#ef4444')
GREEN = colors.HexColor('#10b981')
WHITE = colors.white

W, H = A4

def kes(n):
    try: return f"KES {float(n or 0):,.2f}"
    except: return "KES 0.00"

def fmt_date(d):
    if not d: return "—"
    try: return datetime.fromisoformat(str(d)[:10]).strftime("%-d %b %Y")
    except: return str(d)[:10]

title_s = ParagraphStyle('t', fontSize=18, fontName='Helvetica-Bold', textColor=DARK, spaceAfter=4)
sub_s   = ParagraphStyle('s', fontSize=9,  fontName='Helvetica',      textColor=GRAY, spaceAfter=2)
h2_s    = ParagraphStyle('h', fontSize=11, fontName='Helvetica-Bold', textColor=DARK, spaceBefore=12, spaceAfter=6)
body_s  = ParagraphStyle('b', fontSize=9,  fontName='Helvetica',      textColor=DARK)
right_s = ParagraphStyle('r', fontSize=9,  fontName='Helvetica',      textColor=DARK, alignment=TA_RIGHT)
note_s  = ParagraphStyle('n', fontSize=8,  fontName='Helvetica-Oblique', textColor=GRAY, spaceAfter=4)

doc = SimpleDocTemplate(out_path, pagesize=A4,
    rightMargin=1.8*cm, leftMargin=1.8*cm, topMargin=2*cm, bottomMargin=2*cm)
story = []

# Header
story.append(Paragraph(data['companyName'], ParagraphStyle('co', fontSize=10, fontName='Helvetica-Bold', textColor=TEAL)))
story.append(Spacer(1, 3))
story.append(Paragraph('Remittance Statement', title_s))
story.append(Paragraph(f"Period: {data['month']}", sub_s))
if data['companyPhone']: story.append(Paragraph(f"Tel: {data['companyPhone']}  |  {data['companyEmail']}", sub_s))
story.append(Spacer(1, 10))
story.append(HRFlowable(width='100%', thickness=2, color=TEAL))
story.append(Spacer(1, 10))

# Landlord info
story.append(Paragraph('Prepared for:', ParagraphStyle('lbl', fontSize=8, fontName='Helvetica', textColor=GRAY)))
story.append(Paragraph(data['landlordName'], ParagraphStyle('ln', fontSize=12, fontName='Helvetica-Bold', textColor=DARK, spaceAfter=2)))
if data['landlordBank']:
    story.append(Paragraph(f"Bank: {data['landlordBank']}", sub_s))
story.append(Spacer(1, 16))

# Line items table
story.append(Paragraph('Property Breakdown', h2_s))
headers = ['Property', 'Units', 'Billed', 'Collected', 'Commission', 'Expenses', 'Net']
col_w   = [5.5*cm, 1.5*cm, 2.2*cm, 2.2*cm, 2.5*cm, 2.2*cm, 2.2*cm]
tbl_data = [headers]
for ln in data['lines']:
    comm_label = f"{ln['commissionRate']:.0f}%" if ln['commissionType']=='percentage' else 'Flat'
    tbl_data.append([
        ln['propertyName'],
        f"{ln['occupiedUnits']}/{ln['unitCount']}",
        kes(ln['amountBilled']),
        kes(ln['amountCollected']),
        f"{kes(ln['commissionAmount'])} ({comm_label})",
        kes(ln['expensesAmount']),
        kes(ln['netAmount']),
    ])

tbl = Table(tbl_data, colWidths=col_w, repeatRows=1)
tbl.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), DARK),
    ('TEXTCOLOR',  (0,0), (-1,0), WHITE),
    ('FONTNAME',   (0,0), (-1,0), 'Helvetica-Bold'),
    ('FONTSIZE',   (0,0), (-1,-1), 8),
    ('ROWBACKGROUNDS', (0,1), (-1,-1), [WHITE, LIGHT]),
    ('GRID',       (0,0), (-1,-1), 0.3, colors.HexColor('#e2e8f0')),
    ('ALIGN',      (1,0), (-1,-1), 'RIGHT'),
    ('TOPPADDING', (0,0), (-1,-1), 5),
    ('BOTTOMPADDING',(0,0),(-1,-1), 5),
]))
story.append(tbl)
story.append(Spacer(1, 16))

# Summary box
summary_data = [
    ['Gross Rent Collected', kes(data['grossCollected'])],
    ['Less: Agent Commission', f"- {kes(data['commissionAmount'])}"],
    ['Less: Property Expenses', f"- {kes(data['expensesDeducted'])}"],
]
summary_tbl = Table(summary_data, colWidths=[8*cm, 4*cm])
summary_tbl.setStyle(TableStyle([
    ('FONTSIZE',   (0,0), (-1,-1), 9),
    ('FONTNAME',   (0,1), (-1,1), 'Helvetica'),
    ('FONTNAME',   (0,2), (-1,2), 'Helvetica'),
    ('ALIGN',      (1,0), (1,-1), 'RIGHT'),
    ('TOPPADDING', (0,0), (-1,-1), 4),
    ('BOTTOMPADDING',(0,0),(-1,-1), 4),
    ('LINEBELOW',  (0,-1), (-1,-1), 0.5, GRAY),
]))
story.append(summary_tbl)
story.append(Spacer(1, 6))

# Net payable — big
net_tbl = Table([['NET PAYABLE TO LANDLORD', kes(data['netPayable'])]], colWidths=[8*cm, 4*cm])
net_tbl.setStyle(TableStyle([
    ('BACKGROUND',  (0,0), (-1,-1), TEAL),
    ('TEXTCOLOR',   (0,0), (-1,-1), WHITE),
    ('FONTNAME',    (0,0), (-1,-1), 'Helvetica-Bold'),
    ('FONTSIZE',    (0,0), (-1,-1), 11),
    ('ALIGN',       (1,0), (1,-1), 'RIGHT'),
    ('TOPPADDING',  (0,0), (-1,-1), 8),
    ('BOTTOMPADDING',(0,0),(-1,-1), 8),
    ('LEFTPADDING', (0,0), (-1,-1), 10),
    ('RIGHTPADDING',(0,0), (-1,-1), 10),
]))
story.append(net_tbl)

# Notes
if data.get('notes'):
    story.append(Spacer(1, 14))
    story.append(Paragraph('Notes from Agent:', ParagraphStyle('nl', fontSize=9, fontName='Helvetica-Bold', textColor=DARK, spaceAfter=4)))
    story.append(Paragraph(data['notes'], note_s))

# Payment ref
if data.get('paymentRef'):
    story.append(Spacer(1, 8))
    story.append(Paragraph(f"Payment Reference: {data['paymentRef']}", sub_s))

# Footer
story.append(Spacer(1, 20))
story.append(HRFlowable(width='100%', thickness=0.5, color=colors.HexColor('#e2e8f0')))
story.append(Spacer(1, 6))
story.append(Paragraph(f"Generated by PropManager · {datetime.now().strftime('%-d %b %Y')}", ParagraphStyle('ft', fontSize=7, fontName='Helvetica', textColor=GRAY, alignment=TA_CENTER)))

doc.build(story)
print("OK")
`;

  try {
    await writeFile(tmpIn, JSON.stringify(pdfData));
    await writeFile(tmpIn + '.py', PYTHON_SCRIPT);
    await execFileAsync('python3', [tmpIn + '.py', tmpIn, tmpOut]);
    const pdfBuffer = await readFile(tmpOut);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="remittance-${statement.landlord_name.replace(/\s+/g, '-')}-${month.replace(/\s+/g, '-')}.pdf"`
    );
    res.send(pdfBuffer);
  } finally {
    unlink(tmpIn).catch(() => {});
    unlink(tmpIn + '.py').catch(() => {});
    unlink(tmpOut).catch(() => {});
  }
});