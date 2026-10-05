import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseStatementFile, StatementFileError } from './statement-file';

describe('parseStatementFile', () => {
  it('parses CSV fields containing quoted commas', async () => {
    const rows = await parseStatementFile(
      'statement.csv',
      Buffer.from('Date,Amount,Remarks\r\n2026-10-01,1200,"Jane Doe, rent"\r\n')
    );

    expect(rows).toEqual([
      { Date: '2026-10-01', Amount: '1200', Remarks: 'Jane Doe, rent' },
    ]);
  });

  it('parses .xlsx transactions and Excel date cells', async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Statement');
    worksheet.addRow(['Value Date', 'Credit Amount', 'Remarks']);
    worksheet.addRow([new Date(2026, 9, 1), 1200, 'Jane Doe']);
    const bytes = await workbook.xlsx.writeBuffer();

    const rows = await parseStatementFile('statement.xlsx', Buffer.from(bytes));

    expect(rows).toEqual([
      { 'Value Date': '2026-10-01', 'Credit Amount': '1200', Remarks: 'Jane Doe' },
    ]);
  });

  it('rejects unsupported file types', async () => {
    await expect(parseStatementFile('statement.xls', Buffer.from('data')))
      .rejects.toBeInstanceOf(StatementFileError);
  });
});
