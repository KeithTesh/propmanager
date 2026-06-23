// api/src/modules/reports/xlsx.generator.ts
// Pure Node.js Excel generation using exceljs — no Python required
// Install: npm install exceljs

import ExcelJS from 'exceljs';

const KES = (n: string | number) => Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PCT = (n: number) => `${n.toFixed(1)}%`;

// ─── STYLES ───────────────────────────────────────────────────────────────────

const TEAL   = '0D9F9F';
const WHITE  = 'FFFFFF';
const LIGHT  = 'F0FAFA';
const BORDER_THIN = { style: 'thin' as const, color: { argb: 'E2E8F0' } };
const BORDERS = { top: BORDER_THIN, left: BORDER_THIN, bottom: BORDER_THIN, right: BORDER_THIN };

function headerRow(ws: ExcelJS.Worksheet, row: number, values: string[]) {
  const r = ws.getRow(row);
  values.forEach((v, i) => {
    const cell = r.getCell(i + 1);
    cell.value = v;
    cell.font = { bold: true, color: { argb: WHITE }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = BORDERS;
  });
  r.height = 22;
}

function dataRow(ws: ExcelJS.Worksheet, row: number, values: (string | number | null)[], shade = false) {
  const r = ws.getRow(row);
  values.forEach((v, i) => {
    const cell = r.getCell(i + 1);
    cell.value = v ?? '—';
    cell.font = { size: 9.5 };
    cell.fill = shade ? { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } } : { type: 'pattern', pattern: 'solid', fgColor: { argb: WHITE } };
    cell.border = BORDERS;
    if (typeof v === 'number') cell.alignment = { horizontal: 'right' };
  });
  r.height = 18;
}

function titleBlock(ws: ExcelJS.Worksheet, title: string, subtitle: string, cols: number) {
  ws.mergeCells(1, 1, 1, cols);
  const t = ws.getCell(1, 1);
  t.value = 'PropManager';
  t.font = { bold: true, size: 14, color: { argb: TEAL } };
  t.alignment = { horizontal: 'center' };

  ws.mergeCells(2, 1, 2, cols);
  const sub = ws.getCell(2, 1);
  sub.value = title;
  sub.font = { bold: true, size: 11 };
  sub.alignment = { horizontal: 'center' };

  ws.mergeCells(3, 1, 3, cols);
  const s = ws.getCell(3, 1);
  s.value = subtitle;
  s.font = { size: 9.5, color: { argb: '64748B' } };
  s.alignment = { horizontal: 'center' };

  ws.getRow(4).height = 8; // spacer
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

export async function generateReportXlsx(data: any): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PropManager';
  wb.created = new Date();

  switch (data.type) {
    case 'income-statement': return buildIncomeStatement(wb, data);
    case 'rent-roll':        return buildRentRoll(wb, data);
    case 'occupancy':        return buildOccupancy(wb, data);
    case 'collection':       return buildCollection(wb, data);
    default: throw new Error(`Unknown report type: ${data.type}`);
  }
}

// ─── INCOME STATEMENT ────────────────────────────────────────────────────────

async function buildIncomeStatement(wb: ExcelJS.Workbook, data: any): Promise<Buffer> {
  const ws = wb.addWorksheet('Income Statement');
  ws.pageSetup = { orientation: 'portrait', fitToPage: true };

  const COLS = 3;
  ws.columns = [
    { width: 36 }, { width: 18 }, { width: 18 },
  ];

  titleBlock(ws, `Income Statement — ${data.companyName}`, `${data.fromDate} to ${data.toDate}`, COLS);

  let row = 5;

  // Revenue section
  const revHeader = ws.getRow(row++);
  ws.mergeCells(row - 1, 1, row - 1, COLS);
  revHeader.getCell(1).value = 'REVENUE';
  revHeader.getCell(1).font = { bold: true, size: 10, color: { argb: TEAL } };
  revHeader.height = 20;

  headerRow(ws, row++, ['Category', 'Amount (KES)', '']);

  const revItems = [
    ['Rent Revenue',       data.revenue.rent_revenue],
    ['Signing Bills',      data.revenue.signing_revenue],
    ['Penalty Revenue',    data.revenue.penalty_revenue],
    ['Adjustment Revenue', data.revenue.adjustment_revenue],
  ];
  revItems.forEach(([label, val], i) => dataRow(ws, row++, [label, KES(val), ''], i % 2 === 0));

  // Total revenue
  const totalRevRow = ws.getRow(row++);
  totalRevRow.getCell(1).value = 'Total Revenue';
  totalRevRow.getCell(2).value = KES(data.revenue.total_revenue);
  totalRevRow.eachCell(c => { c.font = { bold: true, size: 10 }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'DCFCE7' } }; c.border = BORDERS; });
  totalRevRow.height = 20;
  row++; // spacer

  // Expenses
  const expHeader = ws.getRow(row++);
  ws.mergeCells(row - 1, 1, row - 1, COLS);
  expHeader.getCell(1).value = 'EXPENSES';
  expHeader.getCell(1).font = { bold: true, size: 10, color: { argb: 'EF4444' } };

  headerRow(ws, row++, ['Category', 'Amount (KES)', 'Notes']);
  data.expenses.forEach((e: any, i: number) => dataRow(ws, row++, [e.category, KES(e.amount), e.description ?? ''], i % 2 === 0));

  const totalExpRow = ws.getRow(row++);
  totalExpRow.getCell(1).value = 'Total Expenses';
  totalExpRow.getCell(2).value = KES(data.expTotals.total_expenses);
  totalExpRow.eachCell(c => { c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEE2E2' } }; c.border = BORDERS; });
  row++;

  // Net income
  const netRow = ws.getRow(row++);
  netRow.getCell(1).value = 'NET INCOME';
  netRow.getCell(2).value = KES(data.netIncome);
  const netColor = data.netIncome >= 0 ? 'DCFCE7' : 'FEE2E2';
  netRow.eachCell(c => { c.font = { bold: true, size: 11 }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: netColor } }; c.border = BORDERS; });
  netRow.height = 24;

  return wb.xlsx.writeBuffer() as Promise<Buffer>;
}

// ─── RENT ROLL ────────────────────────────────────────────────────────────────

async function buildRentRoll(wb: ExcelJS.Workbook, data: any): Promise<Buffer> {
  const ws = wb.addWorksheet('Rent Roll');

  const headers = ['Property', 'Unit', 'Type', 'Tenant', 'Phone', 'Rent (KES)', 'Start Date', 'End Date', 'Status'];
  ws.columns = headers.map((_, i) => ({ width: [22, 10, 10, 22, 15, 14, 12, 12, 10][i] }));

  titleBlock(ws, `Rent Roll — ${data.companyName}`, `As of ${data.asOf}`, headers.length);

  let row = 5;
  headerRow(ws, row++, headers);

  data.rows.forEach((r: any, i: number) => {
    dataRow(ws, row++, [
      r.property_name, r.unit_number, r.unit_type ?? '—',
      r.tenant_name ?? 'Vacant', r.phone ?? '—',
      r.tenant_name ? KES(r.monthly_rent) : '—',
      r.start_date ?? '—', r.end_date ?? '—',
      r.tenant_name ? 'Occupied' : 'Vacant',
    ], i % 2 === 0);
  });

  // Summary
  const occupied = data.rows.filter((r: any) => r.tenant_name).length;
  const totalRent = data.rows.reduce((s: number, r: any) => s + (r.tenant_name ? Number(r.monthly_rent) : 0), 0);
  row++;
  dataRow(ws, row++, [`Total: ${data.rows.length} units · ${occupied} occupied · ${data.rows.length - occupied} vacant`, '', '', '', '', KES(totalRent), '', '', '']);
  ws.getRow(row - 1).eachCell(c => { c.font = { bold: true }; });

  return wb.xlsx.writeBuffer() as Promise<Buffer>;
}

// ─── OCCUPANCY ────────────────────────────────────────────────────────────────

async function buildOccupancy(wb: ExcelJS.Workbook, data: any): Promise<Buffer> {
  const ws = wb.addWorksheet('Occupancy');

  const headers = ['Property', 'Total Units', 'Occupied', 'On Notice', 'Vacant', 'Occ. Rate', 'Potential Rent', 'Actual Rent'];
  ws.columns = headers.map(() => ({ width: 16 }));
  ws.columns[0] = { width: 28 };

  titleBlock(ws, `Occupancy Report — ${data.companyName}`, `As of ${data.asOf}`, headers.length);

  let row = 5;
  headerRow(ws, row++, headers);

  data.byProperty.forEach((p: any, i: number) => {
    const rate = Number(p.total_units) > 0 ? ((Number(p.occupied) / Number(p.total_units)) * 100) : 0;
    dataRow(ws, row++, [
      p.property_name, p.total_units, p.occupied, p.on_notice, p.vacant,
      PCT(rate), KES(p.potential_rent), KES(p.actual_rent),
    ], i % 2 === 0);
  });

  // Totals
  row++;
  const t = data.totals;
  const overallRate = Number(t.total_units) > 0 ? ((Number(t.occupied) / Number(t.total_units)) * 100) : 0;
  const totalRow = ws.getRow(row);
  ['TOTAL', t.total_units, t.occupied, t.on_notice, t.vacant, PCT(overallRate), '', ''].forEach((v, i) => {
    const cell = totalRow.getCell(i + 1);
    cell.value = v;
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
    cell.border = BORDERS;
  });

  return wb.xlsx.writeBuffer() as Promise<Buffer>;
}

// ─── COLLECTION ───────────────────────────────────────────────────────────────

async function buildCollection(wb: ExcelJS.Workbook, data: any): Promise<Buffer> {
  const ws = wb.addWorksheet('Collection');

  const headers = ['Tenant', 'Unit', 'Property', 'Billed (KES)', 'Paid (KES)', 'Balance (KES)', 'Status'];
  ws.columns = [{ width: 22 }, { width: 10 }, { width: 22 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 12 }];

  titleBlock(ws, `Collection Report — ${data.companyName}`, `${data.forMonth.slice(0, 7)}`, headers.length);

  let row = 5;
  headerRow(ws, row++, headers);

  data.rows.forEach((r: any, i: number) => {
    dataRow(ws, row++, [
      r.tenant_name, r.unit_number, r.property_name,
      KES(r.total_amount), KES(r.total_paid), KES(r.total_due), r.status,
    ], i % 2 === 0);
  });

  row++;
  const s = data.summary;
  const summaryRow = ws.getRow(row);
  [`${data.rows.length} bills · Collection rate: ${data.collectionRate}%`, '', '', KES(s.total_billed), KES(s.total_collected), KES(s.total_outstanding), ''].forEach((v, i) => {
    const cell = summaryRow.getCell(i + 1);
    cell.value = v;
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
    cell.border = BORDERS;
  });

  return wb.xlsx.writeBuffer() as Promise<Buffer>;
}