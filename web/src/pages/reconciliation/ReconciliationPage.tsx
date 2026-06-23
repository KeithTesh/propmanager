// web/src/pages/reconciliation/ReconciliationPage.tsx

import { useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, getApiErrorMessage } from '../../lib/api';

interface Batch {
  id: string; bank_name: string; filename: string;
  total_rows: number; matched_rows: number; unmatched_rows: number; duplicate_rows: number;
  status: string; imported_by_name: string; created_at: string; completed_at: string | null;
}

interface Unmatched {
  id: string; amount: string; payer_name: string | null; payer_reference: string | null;
  payer_phone: string | null; transaction_ref: string | null; transaction_date: string;
  bank_name: string | null;
  suggested_tenant_name: string | null; suggested_unit_number: string | null;
  suggested_property_name: string | null; suggested_lease_id: string | null;
  suggestion_confidence: number | null;
}

interface Lease {
  id: string; snap_account_reference: string;
  tenant_name: string; unit_number: string; property_name: string;
}

const KES  = (n: string | number) => 'KES ' + Number(n).toLocaleString('en-KE', { maximumFractionDigits: 0 });
const DATE = (d: string) => new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });

// CSV column mapping — common bank export formats
const BANK_COLUMNS: Record<string, { date: string; ref: string; amount: string; payer: string; phone?: string }> = {
  'Equity Bank':  { date: 'Value Date', ref: 'Transaction ID',    amount: 'Credit Amount', payer: 'Remarks' },
  'KCB Bank':     { date: 'Trans. Date', ref: 'Reference No.',    amount: 'Credit',        payer: 'Description' },
  'Co-op Bank':   { date: 'Date',        ref: 'Cheque No',        amount: 'Credit',        payer: 'Narration' },
  'NCBA Bank':    { date: 'Date',        ref: 'Reference',        amount: 'Credit Amount', payer: 'Description' },
  'Custom':       { date: 'date',        ref: 'ref',              amount: 'amount',        payer: 'payer', phone: 'phone' },
};

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
  });
}

export default function ReconciliationPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'import' | 'unmatched' | 'history'>('import');
  const [bankName,   setBankName]   = useState('Equity Bank');
  const [csvRows,    setCsvRows]    = useState<Record<string, string>[]>([]);
  const [colMap,     setColMap]     = useState<Record<string, string>>({});
  const [filename,   setFilename]   = useState('');
  const [fileHash,   setFileHash]   = useState('');
  const [importing,  setImporting]  = useState(false);
  const [importResult, setImportResult] = useState<{ matched: number; unmatched: number; duplicates: number } | null>(null);
  const [error, setError] = useState('');
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [searchLeases, setSearchLeases] = useState('');
  const [leaseResults, setLeaseResults] = useState<Lease[]>([]);

  const { data: batches }   = useQuery({ queryKey: ['csv-batches'],   queryFn: async () => (await apiClient.get<any>('/reconciliation/batches')).data.data.batches, enabled: tab === 'history' });
  const { data: unmatched } = useQuery({ queryKey: ['unmatched'],     queryFn: async () => (await apiClient.get<any>('/reconciliation/unmatched')).data.data.unmatched, enabled: tab === 'unmatched' });

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    setError(''); setImportResult(null);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = ev.target?.result as string;
      // Hash for duplicate detection
      const encoder = new TextEncoder();
      const data = encoder.encode(text);
      const hashBuf = await crypto.subtle.digest('SHA-256', data);
      const hashArr = Array.from(new Uint8Array(hashBuf));
      setFileHash(hashArr.map(b => b.toString(16).padStart(2, '0')).join(''));

      const rows = parseCSV(text);
      setCsvRows(rows);

      // Auto-detect column mapping for known banks
      if (rows.length > 0) {
        const suggested = BANK_COLUMNS[bankName] ?? BANK_COLUMNS['Custom'];
        const headers   = Object.keys(rows[0]);
        const mapped: Record<string, string> = {
          transactionDate: headers.find(h => h.toLowerCase().includes('date')) ?? suggested.date,
          transactionRef:  headers.find(h => h.toLowerCase().includes('ref') || h.toLowerCase().includes('id')) ?? suggested.ref,
          amount:          headers.find(h => h.toLowerCase().includes('credit') || h.toLowerCase().includes('amount')) ?? suggested.amount,
          payerName:       headers.find(h => h.toLowerCase().includes('remark') || h.toLowerCase().includes('narr') || h.toLowerCase().includes('desc')) ?? suggested.payer,
          payerReference:  headers.find(h => h.toLowerCase().includes('account') || h.toLowerCase().includes('acc')) ?? '',
          payerPhone:      headers.find(h => h.toLowerCase().includes('phone') || h.toLowerCase().includes('mobile')) ?? '',
        };
        setColMap(mapped);
      }
    };
    reader.readAsText(file);
  }

  async function runImport() {
    if (!csvRows.length) { setError('Upload a CSV file first'); return; }
    setImporting(true); setError(''); setImportResult(null);
    try {
      const rows = csvRows.map(row => ({
        transactionDate: row[colMap.transactionDate] ?? '',
        transactionRef:  row[colMap.transactionRef]  || null,
        amount:          parseFloat(row[colMap.amount]?.replace(/[^0-9.]/g, '') ?? '0'),
        payerName:       row[colMap.payerName]       || null,
        payerReference:  row[colMap.payerReference]  || null,
        payerPhone:      row[colMap.payerPhone]      || null,
        bankName:        bankName,
      })).filter(r => r.amount > 0 && r.transactionDate);

      const res = await apiClient.post<{ data: { matched: number; unmatched: number; duplicates: number } }>(
        '/reconciliation/import',
        { bankName, filename, fileHash, rows }
      );
      setImportResult(res.data.data);
      qc.invalidateQueries({ queryKey: ['csv-batches'] });
      qc.invalidateQueries({ queryKey: ['unmatched'] });
      qc.invalidateQueries({ queryKey: ['bills'] });
      qc.invalidateQueries({ queryKey: ['payments-summary'] });
    } catch (e) { setError(getApiErrorMessage(e)); }
    finally { setImporting(false); }
  }

  async function searchForLease(q: string) {
    setSearchLeases(q);
    if (q.length < 2) { setLeaseResults([]); return; }
    try {
      const res = await apiClient.get<{ data: { leases: Lease[] } }>(`/leases?search=${encodeURIComponent(q)}&limit=10`);
      setLeaseResults(res.data.data.leases ?? []);
    } catch { setLeaseResults([]); }
  }

  async function assign(unmatchedId: string, leaseId: string) {
    try {
      await apiClient.post('/reconciliation/assign', { unmatchedId, leaseId });
      qc.invalidateQueries({ queryKey: ['unmatched'] });
      qc.invalidateQueries({ queryKey: ['bills'] });
      qc.invalidateQueries({ queryKey: ['payments-summary'] });
      setAssigningId(null); setLeaseResults([]); setSearchLeases('');
    } catch (e) { setError(getApiErrorMessage(e)); }
  }

  const headers = csvRows.length > 0 ? Object.keys(csvRows[0]) : [];

  return (
    <div className="p-6 lg:p-8 ">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Reconciliation</h1>
        <p className="text-sm text-gray-500 mt-0.5">Import bank statements and match payments to leases</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit">
        {([['import','Import CSV'],['unmatched',`Unmatched${unmatched?.length ? ` (${unmatched.length})` : ''}`],['history','History']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap
              ${tab === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}

      {/* ── Import tab ── */}
      {tab === 'import' && (
        <div className="space-y-5">
          {importResult && (
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
              ✅ Import complete —
              <strong> {importResult.matched}</strong> matched ·
              <strong> {importResult.unmatched}</strong> unmatched ·
              <strong> {importResult.duplicates}</strong> duplicates skipped
              {importResult.unmatched > 0 && (
                <button onClick={() => setTab('unmatched')} className="ml-2 underline font-medium">
                  Review unmatched →
                </button>
              )}
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
            {/* Bank + file */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Bank</label>
                <select value={bankName} onChange={e => setBankName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500">
                  {Object.keys(BANK_COLUMNS).map(b => <option key={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">CSV File</label>
                <div
                  onClick={() => fileRef.current?.click()}
                  className="w-full px-3.5 py-2.5 rounded-lg border-2 border-dashed border-gray-200 text-sm text-gray-500 cursor-pointer hover:border-teal-400 hover:text-teal-600 transition text-center">
                  {filename || 'Click to upload CSV…'}
                </div>
                <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={onFileChange} />
              </div>
            </div>

            {/* Column mapping */}
            {csvRows.length > 0 && headers.length > 0 && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-3">Column Mapping <span className="text-gray-400 font-normal">({csvRows.length} rows loaded)</span></p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { key: 'transactionDate', label: 'Transaction Date *' },
                    { key: 'amount',          label: 'Credit Amount *' },
                    { key: 'transactionRef',  label: 'Transaction Ref' },
                    { key: 'payerName',       label: 'Payer Name' },
                    { key: 'payerReference',  label: 'Account Reference' },
                    { key: 'payerPhone',      label: 'Phone Number' },
                  ].map(f => (
                    <div key={f.key}>
                      <label className="block text-xs text-gray-500 mb-1">{f.label}</label>
                      <select value={colMap[f.key] ?? ''} onChange={e => setColMap(m => ({...m, [f.key]: e.target.value}))}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500">
                        <option value="">— not in file —</option>
                        {headers.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  ))}
                </div>

                {/* Preview */}
                <div className="mt-4 overflow-x-auto rounded-xl border border-gray-100">
                  <table className="w-full text-xs">
                    <thead><tr className="bg-gray-50 border-b border-gray-100">
                      {['Date','Ref','Amount','Payer','Acct Ref'].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500">{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {csvRows.slice(0, 5).map((row, i) => (
                        <tr key={i} className="border-b border-gray-50">
                          <td className="px-3 py-2 text-gray-600">{row[colMap.transactionDate] ?? '—'}</td>
                          <td className="px-3 py-2 text-gray-600 font-mono">{row[colMap.transactionRef] ?? '—'}</td>
                          <td className="px-3 py-2 font-medium text-gray-900">{row[colMap.amount] ?? '—'}</td>
                          <td className="px-3 py-2 text-gray-600">{row[colMap.payerName] ?? '—'}</td>
                          <td className="px-3 py-2 text-gray-600">{row[colMap.payerReference] ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {csvRows.length > 5 && <p className="text-xs text-gray-400 px-3 py-2">… and {csvRows.length - 5} more rows</p>}
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button onClick={runImport} disabled={importing || !csvRows.length}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60 transition"
                style={{ background: '#0d9f9f' }}>
                {importing && <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
                {importing ? 'Importing…' : `Import ${csvRows.length > 0 ? csvRows.length + ' rows' : 'CSV'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Unmatched tab ── */}
      {tab === 'unmatched' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {!unmatched?.length ? (
            <div className="text-center py-16">
              <p className="text-sm text-gray-400">No unmatched payments 🎉</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {unmatched.map((u: Unmatched) => (
                <div key={u.id} className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <p className="text-base font-bold text-gray-900">{KES(u.amount)}</p>
                        <span className="text-xs text-gray-400">{DATE(u.transaction_date)}</span>
                        {u.transaction_ref && <span className="text-xs font-mono text-gray-500">{u.transaction_ref}</span>}
                      </div>
                      <p className="text-sm text-gray-600">{u.payer_name ?? 'Unknown payer'}</p>
                      {u.payer_reference && <p className="text-xs text-gray-400">Account ref: {u.payer_reference}</p>}
                      {u.payer_phone    && <p className="text-xs text-gray-400">Phone: {u.payer_phone}</p>}

                      {/* Suggestion */}
                      {u.suggested_tenant_name && (
                        <div className="mt-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200">
                          <p className="text-xs font-medium text-amber-800">
                            💡 Possible match ({u.suggestion_confidence}% confidence): {u.suggested_tenant_name} · Unit {u.suggested_unit_number} · {u.suggested_property_name}
                          </p>
                          {u.suggested_lease_id && (
                            <button onClick={() => assign(u.id, u.suggested_lease_id!)}
                              className="mt-1.5 text-xs font-semibold text-amber-700 underline hover:text-amber-900">
                              Accept suggestion →
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    <button onClick={() => setAssigningId(assigningId === u.id ? null : u.id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold transition shrink-0"
                      style={{ background: '#0d9f9f', color: 'white' }}>
                      Assign
                    </button>
                  </div>

                  {/* Manual assign search */}
                  {assigningId === u.id && (
                    <div className="mt-3 p-3 rounded-xl bg-gray-50 border border-gray-200">
                      <input value={searchLeases} onChange={e => searchForLease(e.target.value)}
                        placeholder="Search tenant name or unit…"
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 mb-2" />
                      {leaseResults.length > 0 && (
                        <div className="space-y-1">
                          {leaseResults.map(l => (
                            <button key={l.id} onClick={() => assign(u.id, l.id)}
                              className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-white border border-transparent hover:border-gray-200 transition">
                              <span className="font-medium text-gray-900">{l.tenant_name}</span>
                              <span className="text-gray-400 ml-2">Unit {l.unit_number} · {l.property_name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── History tab ── */}
      {tab === 'history' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {!batches?.length ? (
            <div className="text-center py-16"><p className="text-sm text-gray-400">No imports yet</p></div>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                {['File','Bank','Rows','Matched','Unmatched','Status','Imported By','Date'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {batches.map((b: Batch) => (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-600 max-w-[12rem] truncate">{b.filename}</td>
                    <td className="px-4 py-3 text-gray-700">{b.bank_name}</td>
                    <td className="px-4 py-3 text-gray-700">{b.total_rows}</td>
                    <td className="px-4 py-3 text-emerald-600 font-medium">{b.matched_rows}</td>
                    <td className="px-4 py-3 text-amber-600 font-medium">{b.unmatched_rows}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize
                        ${b.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : b.status === 'failed' ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
                        {b.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{b.imported_by_name}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{DATE(b.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}