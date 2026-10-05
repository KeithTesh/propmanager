import ExcelJS from 'exceljs';
import { parse as parseCsv } from 'csv-parse/sync';

export class StatementFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StatementFileError';
  }
}

function normalizeHeaders(values: unknown[]): string[] {
  const seen = new Map<string, number>();
  return values.map((value, index) => {
    const header = String(value ?? '').trim() || `Column ${index + 1}`;
    const count = seen.get(header) ?? 0;
    seen.set(header, count + 1);
    return count === 0 ? header : `${header} (${count + 1})`;
  });
}

interface StatementRow {
  values: unknown[];
  hasColoredCells?: boolean;
}

const HEADER_PATTERNS: Record<string, RegExp> = {
  date: /\b(date|dated|time|timestamp)\b/,
  amount: /\b(amount|credit|deposit|received|paid|payment|money in|paid in)\b/,
  reference: /\b(ref|reference|transaction id|transaction no|receipt|cheque|check no|code)\b/,
  payer: /\b(payer|sender|tenant|customer|name|description|narration|remarks?|details|particulars)\b/,
  account: /\b(account|acct|a\/c)\b/,
  phone: /\b(phone|mobile|msisdn|telephone)\b/,
};

function headerScore(row: StatementRow): number {
  const cells = row.values.map(value => String(value ?? '').trim().toLowerCase()).filter(Boolean);
  if (!cells.length) return 0;

  const categories = new Set<string>();
  let score = 0;
  for (const cell of cells) {
    for (const [category, pattern] of Object.entries(HEADER_PATTERNS)) {
      if (pattern.test(cell)) {
        categories.add(category);
        break;
      }
    }
    if (/\b(date|dated|time|timestamp)\b/.test(cell)) score += 4;
    if (/\b(credit|amount|deposit|received|paid|payment|money in|paid in)\b/.test(cell)) score += 4;
    if (/\b(ref|reference|transaction|receipt|cheque|check|code)\b/.test(cell)) score += 2;
    if (/\b(payer|sender|tenant|customer|name|description|narration|remarks?|details|particulars|account|acct|phone|mobile)\b/.test(cell)) score += 1;
  }

  if (categories.has('date') && categories.has('amount')) score += 4;
  if (row.hasColoredCells && cells.length >= 2) score += 5;
  return score;
}

function rowsToRecords(rows: StatementRow[]): Record<string, string>[] {
  const candidates = rows
    .map((row, index) => ({ row, index, score: headerScore(row) }))
    .filter(candidate => candidate.row.values.some(value => String(value ?? '').trim()))
    .slice(0, 100);
  const bestCandidate = candidates.reduce<typeof candidates[number] | null>(
    (best, candidate) => candidate.score > (best?.score ?? 0) ? candidate : best,
    null
  );
  const headerIndex = bestCandidate && bestCandidate.score >= 4
    ? bestCandidate.index
    : candidates[0]?.index;
  const headerRow = headerIndex === undefined ? undefined : rows[headerIndex]?.values;
  const dataRows = headerIndex === undefined ? [] : rows.slice(headerIndex + 1).map(row => row.values);
  if (!headerRow?.some(value => String(value ?? '').trim())) {
    throw new StatementFileError('The file must contain a header row and transaction rows.');
  }

  const headers = normalizeHeaders(headerRow);
  const records = dataRows
    .filter(row => row.some(value => String(value ?? '').trim() !== ''))
    .map(row => Object.fromEntries(headers.map((header, index) => [header, String(row[index] ?? '').trim()])));

  if (records.length === 0) {
    throw new StatementFileError('No transaction rows were found in the file.');
  }
  if (records.length > 5000) {
    throw new StatementFileError('A maximum of 5,000 transaction rows can be imported at a time.');
  }
  return records;
}

function normalizeExcelValue(value: ExcelJS.CellValue): unknown {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  if (value && typeof value === 'object') {
    if ('richText' in value) return value.richText.map(part => part.text).join('');
    if ('text' in value) return value.text;
    if ('result' in value) return normalizeExcelValue(value.result);
    return '';
  }
  return value;
}

export async function parseStatementFile(
  filename: string,
  contents: Buffer
): Promise<Record<string, string>[]> {
  const extension = filename.toLowerCase().split('.').pop();

  try {
    if (extension === 'csv') {
      const parsedRows = parseCsv(contents, {
        bom: true,
        relax_column_count: true,
        skip_empty_lines: true,
        trim: true,
      }) as string[][];
      const rows = parsedRows.map(values => ({ values }));
      return rowsToRecords(rows);
    }

    if (extension === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      const workbookContents = new ArrayBuffer(contents.length);
      new Uint8Array(workbookContents).set(contents);
      await workbook.xlsx.load(workbookContents);
      const worksheet = workbook.worksheets[0];
      if (!worksheet) throw new StatementFileError('The Excel workbook has no worksheets.');

      const rows: StatementRow[] = [];
      worksheet.eachRow({ includeEmpty: false }, row => {
        const values: unknown[] = [];
        let hasColoredCells = false;
        for (let column = 1; column <= row.cellCount; column++) {
          const cell = row.getCell(column);
          values[column - 1] = normalizeExcelValue(cell.value);
          if (cell.fill?.type) hasColoredCells = true;
        }
        rows.push({ values, hasColoredCells });
      });
      return rowsToRecords(rows);
    }
  } catch (error) {
    if (error instanceof StatementFileError) throw error;
    throw new StatementFileError('The file could not be read. Check that it is a valid CSV or .xlsx file.');
  }

  throw new StatementFileError('Unsupported file type. Upload a CSV or Excel (.xlsx) file.');
}
