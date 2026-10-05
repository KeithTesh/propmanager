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

function rowsToRecords(values: unknown[][]): Record<string, string>[] {
  const [headerRow, ...dataRows] = values;
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
      const rows = parseCsv(contents, {
        bom: true,
        relax_column_count: true,
        skip_empty_lines: true,
        trim: true,
      }) as string[][];
      return rowsToRecords(rows);
    }

    if (extension === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      const workbookContents = new ArrayBuffer(contents.length);
      new Uint8Array(workbookContents).set(contents);
      await workbook.xlsx.load(workbookContents);
      const worksheet = workbook.worksheets[0];
      if (!worksheet) throw new StatementFileError('The Excel workbook has no worksheets.');

      const rows: unknown[][] = [];
      worksheet.eachRow({ includeEmpty: false }, row => {
        const values: unknown[] = [];
        for (let column = 1; column <= row.cellCount; column++) {
          values[column - 1] = normalizeExcelValue(row.getCell(column).value);
        }
        rows.push(values);
      });
      return rowsToRecords(rows);
    }
  } catch (error) {
    if (error instanceof StatementFileError) throw error;
    throw new StatementFileError('The file could not be read. Check that it is a valid CSV or .xlsx file.');
  }

  throw new StatementFileError('Unsupported file type. Upload a CSV or Excel (.xlsx) file.');
}
