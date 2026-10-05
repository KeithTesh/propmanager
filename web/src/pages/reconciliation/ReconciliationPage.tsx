// web/src/pages/reconciliation/ReconciliationPage.tsx

import { useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, getApiErrorMessage } from '../../lib/api';
import { confirm } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../components/ui/Toast';

interface Batch {
  id: string; bank_name: string; filename: string;
  total_rows: number; matched_rows: number; unmatched_rows: number; duplicate_rows: number;
  status: string; imported_by_name: string; created_at: string; completed_at: string | null;
}

interface ResolutionHistory {
  id: string; amount: string; payer_name: string | null;
  transaction_ref: string | null; transaction_date: string;
  bank_name: string | null; resolution: 'assigned' | 'wrong_property' | 'written_off' | 'dismissed';
  resolved_at: string | null; resolution_notes: string | null;
  tenant_name: string | null; unit_number: string | null; property_name: string | null;
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
  id: string; snap_account_reference: string | null;
  status: 'active' | 'notice' | 'terminated' | 'expired';
  tenant_name: string; tenant_phone: string | null;
  unit_number: string; property_name: string;
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

function findHeader(headers: string[], patterns: RegExp[], exclude?: RegExp): string {
  for (const pattern of patterns) {
    const match = headers.find(header => pattern.test(header) && !exclude?.test(header));
    if (match) return match;
  }
  return '';
}

export default function ReconciliationPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'import' | 'unmatched' | 'history'>('import');
  const [bankName,   setBankName]   = useState('Equity Bank');
  const [csvRows,    setCsvRows]    = useState<Record<string, string>[]>([]);
  const [colMap,     setColMap]     = useState<Record<string, string>>({});
  const [filename,   setFilename]   = useState('');
  const [fileHash,   setFileHash]   = useState('');
  const [parsing,    setParsing]    = useState(false);
  const [importing,  setImporting]  = useState(false);
  const [importResult, setImportResult] = useState<{ matched: number; unmatched: number; duplicates: number } | null>(null);
  const [showImportSuccess, setShowImportSuccess] = useState(false);
  const [error, setError] = useState('');
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [searchLeases, setSearchLeases] = useState('');
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [dismissingAll, setDismissingAll] = useState(false);

  const { data: batches }   = useQuery({ queryKey: ['csv-batches'],   queryFn: async () => (await apiClient.get<any>('/reconciliation/batches')).data.data.batches, enabled: tab === 'history' });
  const {
    data: unmatched,
    isLoading: unmatchedLoading,
    isError: unmatchedError,
    refetch: refetchUnmatched,
  } = useQuery({
    queryKey: ['unmatched'],
    queryFn: async () => (await apiClient.get<any>('/reconciliation/unmatched')).data.data.unmatched,
    enabled: tab === 'unmatched',
  });
  const { data: resolutionHistory } = useQuery({
    queryKey: ['unmatched-history'],
    queryFn: async () => (await apiClient.get<{ data: { history: ResolutionHistory[] } }>('/reconciliation/unmatched/history')).data.data.history,
    enabled: tab === 'history',
  });
  const assignmentLeaseSearch = useQuery({
    queryKey: ['reconciliation-lease-search', searchLeases],
    queryFn: async () => (await apiClient.get<{ data: { leases: Lease[] } }>(
      `/reconciliation/assignment-leases?search=${encodeURIComponent(searchLeases)}`
    )).data.data.leases,
    enabled: assigningId !== null && searchLeases.trim().length >= 2,
    staleTime: 15_000,
  });

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    setError(''); setImportResult(null);
    setCsvRows([]);
    setColMap({});
    setParsing(true);
    try {
      const contents = await file.arrayBuffer();
      const hashBuf = await crypto.subtle.digest('SHA-256', contents);
      const hashArr = Array.from(new Uint8Array(hashBuf));
      setFileHash(hashArr.map(b => b.toString(16).padStart(2, '0')).join(''));

      const formData = new FormData();
      formData.append('file', file);
      const response = await apiClient.post<{ data: { rows: Record<string, string>[] } }>(
        '/reconciliation/parse',
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      const rows = response.data.data.rows;
      setCsvRows(rows);

      // Auto-detect column mapping for known banks
      if (rows.length > 0) {
        const suggested = BANK_COLUMNS[bankName] ?? BANK_COLUMNS['Custom'];
        const headers   = Object.keys(rows[0]);
        const exactSuggestion = (value: string) => headers.find(header => header.toLowerCase() === value.toLowerCase()) ?? '';
        const mapped: Record<string, string> = {
          transactionDate: findHeader(headers, [/\b(value|transaction|trans|posted|posting|effective)\s*date\b/i, /\bdate\b/i]) || exactSuggestion(suggested.date),
          transactionRef:  findHeader(headers, [/\btransaction\s*(id|ref|reference|no|number)\b/i, /\b(ref|reference|receipt|cheque|check)\b/i, /\b(id|code)\b/i]) || exactSuggestion(suggested.ref),
          amount:          findHeader(headers, [/\bcredit\s*amount\b/i, /\bcredit\b/i, /\b(amount|payment|paid|received|deposit)\b/i], /\b(debit|withdraw|fee|charge|outflow)\b/i) || exactSuggestion(suggested.amount),
          payerName:       findHeader(headers, [/\b(payer|sender|tenant|customer)\s*name\b/i, /\b(name|description|narration|remarks?|details|particulars)\b/i]) || exactSuggestion(suggested.payer),
          payerReference:  findHeader(headers, [/\b(account|acct|a\/c)\s*(no|number|ref|reference)?\b/i, /\b(payer|customer)\s*(ref|reference)\b/i]),
          payerPhone:      findHeader(headers, [/\b(phone|mobile|msisdn|telephone)\b/i]),
        };
        setColMap(mapped);
      }
    } catch (e) {
      setFileHash('');
      setError(getApiErrorMessage(e));
    } finally {
      setParsing(false);
    }
  }

  async function runImport() {
    if (!csvRows.length) { setError('Upload a CSV or Excel (.xlsx) file first'); return; }
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
      if (!rows.length) {
        setError('No valid transactions found. Check the date and amount column mappings.');
        return;
      }

      const res = await apiClient.post<{ data: { matched: number; unmatched: number; duplicates: number } }>(
        '/reconciliation/import',
        { bankName, filename, fileHash, rows }
      );
      setImportResult(res.data.data);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['csv-batches'] }),
        qc.invalidateQueries({ queryKey: ['unmatched'] }),
        qc.invalidateQueries({ queryKey: ['bills'] }),
        qc.invalidateQueries({ queryKey: ['payments'] }),
        qc.invalidateQueries({ queryKey: ['payments-summary'] }),
      ]);
      setShowImportSuccess(true);
    } catch (e) { setError(getApiErrorMessage(e)); }
    finally { setImporting(false); }
  }

  async function assign(unmatchedId: string, leaseId: string, tenantLabel?: string) {
    const payment = unmatched?.find((item: Unmatched) => item.id === unmatchedId);
    const recipient = tenantLabel ?? assignmentLeaseSearch.data?.find(lease => lease.id === leaseId)?.tenant_name ?? 'the selected tenant';
    if (!await confirm({
      title: 'Assign payment to this tenant?',
      message: `Record ${payment ? KES(payment.amount) : 'this payment'} for ${recipient}${payment?.payer_name ? `, paid by ${payment.payer_name}` : ''}. A payer can pay on another tenant’s behalf—the payment will be credited to the selected lease, not matched by payer name.`,
      confirmLabel: 'Assign payment',
      variant: 'warning',
    })) return;

    try {
      const response = await apiClient.post<{ data: { applied: number; remaining: number } }>(
        '/reconciliation/assign',
        { unmatchedId, leaseId }
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['unmatched'] }),
        qc.invalidateQueries({ queryKey: ['unmatched-history'] }),
        qc.invalidateQueries({ queryKey: ['bills'] }),
        qc.invalidateQueries({ queryKey: ['payments'] }),
        qc.invalidateQueries({ queryKey: ['payments-summary'] }),
      ]);
      setAssigningId(null); setSearchLeases('');
      toast(
        response.data.data.remaining > 0.01
          ? `KES ${response.data.data.applied.toLocaleString()} assigned; KES ${response.data.data.remaining.toLocaleString()} remains pending.`
          : 'Payment assigned and saved to reconciliation history.',
        'success'
      );
    } catch (e) { setError(getApiErrorMessage(e)); }
  }

  async function dismissOne(unmatchedId: string) {
    if (!await confirm({
      title: 'Remove unmatched transaction?',
      message: 'It will be removed from the pending list but kept in reconciliation history.',
      confirmLabel: 'Remove from pending',
      variant: 'warning',
    })) return;

    setDismissingId(unmatchedId);
    try {
      await apiClient.post(`/reconciliation/unmatched/${unmatchedId}/dismiss`, {});
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['unmatched'] }),
        qc.invalidateQueries({ queryKey: ['unmatched-history'] }),
      ]);
      toast('Transaction removed from pending and kept in history.', 'success');
    } catch (e) {
      setError(getApiErrorMessage(e));
    } finally {
      setDismissingId(null);
    }
  }

  async function dismissAll() {
    if (!unmatched?.length) return;
    if (!await confirm({
      title: 'Clear all unmatched transactions?',
      message: `This will remove ${unmatched.length} pending transactions from the unmatched list. They will remain in reconciliation history and can still be reviewed there.`,
      confirmLabel: 'Clear pending list',
      variant: 'warning',
    })) return;

    setDismissingAll(true);
    try {
      const response = await apiClient.post<{ data: { dismissed: number } }>('/reconciliation/unmatched/dismiss-all', {});
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['unmatched'] }),
        qc.invalidateQueries({ queryKey: ['unmatched-history'] }),
      ]);
      toast(`${response.data.data.dismissed} transactions moved to history.`, 'success');
    } catch (e) {
      setError(getApiErrorMessage(e));
    } finally {
      setDismissingAll(false);
    }
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
        {([['import','Import Statement'],['unmatched',`Unmatched${unmatched?.length ? ` (${unmatched.length})` : ''}`],['history','History']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap
              ${tab === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}

      {showImportSuccess && importResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="reconciliation-import-title"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
          >
            <div className="mb-3 text-3xl" aria-hidden="true">✅</div>
            <h2 id="reconciliation-import-title" className="text-lg font-bold text-gray-900">Import complete</h2>
            <p className="mt-1 text-sm text-gray-500">{filename} has been processed.</p>
            <div className="mt-5 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-xl bg-emerald-50 p-3">
                <p className="text-lg font-bold text-emerald-700">{importResult.matched}</p>
                <p className="text-xs text-emerald-700">Matched</p>
              </div>
              <div className="rounded-xl bg-amber-50 p-3">
                <p className="text-lg font-bold text-amber-700">{importResult.unmatched}</p>
                <p className="text-xs text-amber-700">Unmatched</p>
              </div>
              <div className="rounded-xl bg-gray-100 p-3">
                <p className="text-lg font-bold text-gray-700">{importResult.duplicates}</p>
                <p className="text-xs text-gray-600">Duplicates skipped</p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setShowImportSuccess(false)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700"
              >
                Done
              </button>
              {importResult.unmatched > 0 && (
                <button
                  onClick={() => { setShowImportSuccess(false); setTab('unmatched'); }}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-white"
                  style={{ background: '#0d9f9f' }}
                >
                  Review unmatched
                </button>
              )}
            </div>
          </section>
        </div>
      )}

      {/* ── Import tab ── */}
      {tab === 'import' && (
        <div className="space-y-5">
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
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Statement File</label>
                <div
                  onClick={() => fileRef.current?.click()}
                  className="w-full px-3.5 py-2.5 rounded-lg border-2 border-dashed border-gray-200 text-sm text-gray-500 cursor-pointer hover:border-teal-400 hover:text-teal-600 transition text-center">
                  {parsing ? 'Reading file…' : filename || 'Click to upload CSV or Excel (.xlsx)…'}
                </div>
                <input ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={onFileChange} />
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
              <button onClick={runImport} disabled={importing || parsing || !csvRows.length}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60 transition"
                style={{ background: '#0d9f9f' }}>
                {importing && <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
                {importing ? 'Importing…' : `Import ${csvRows.length > 0 ? csvRows.length + ' rows' : 'file'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Unmatched tab ── */}
      {tab === 'unmatched' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between gap-4 border-b border-gray-100 p-4">
            <p className="text-sm text-gray-600">
              {unmatched?.length ?? 0} pending transaction{unmatched?.length === 1 ? '' : 's'}
            </p>
            <button
              onClick={dismissAll}
              disabled={!unmatched?.length || dismissingAll}
              className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {dismissingAll ? 'Clearing…' : 'Clear all pending'}
            </button>
          </div>
          {unmatchedLoading ? (
            <div className="py-16 text-center text-sm text-gray-500">Refreshing unmatched transactions…</div>
          ) : unmatchedError ? (
            <div className="py-16 text-center">
              <p className="text-sm text-red-600">Could not load unmatched transactions.</p>
              <button onClick={() => refetchUnmatched()} className="mt-2 text-sm font-medium text-teal-700 underline">Retry</button>
            </div>
          ) : !unmatched?.length ? (
            <div className="text-center py-16">
              <p className="text-sm text-gray-400">No unmatched payments 🎉 Assigned and dismissed transactions remain in History.</p>
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
                            <button onClick={() => assign(u.id, u.suggested_lease_id!, u.suggested_tenant_name ?? undefined)}
                              className="mt-1.5 text-xs font-semibold text-amber-700 underline hover:text-amber-900">
                              Accept suggestion →
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <button onClick={() => {
                        setAssigningId(assigningId === u.id ? null : u.id);
                        setSearchLeases('');
                      }}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold transition"
                        style={{ background: '#0d9f9f', color: 'white' }}>
                        Assign
                      </button>
                      <button
                        onClick={() => dismissOne(u.id)}
                        disabled={dismissingId === u.id}
                        className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                      >
                        {dismissingId === u.id ? 'Removing…' : 'Remove'}
                      </button>
                    </div>
                  </div>

                  {/* Manual assign search */}
                  {assigningId === u.id && (
                    <div className="mt-3 p-3 rounded-xl bg-gray-50 border border-gray-200">
                      <p className="mb-2 text-xs text-gray-600">
                        Search for the tenant whose lease should receive this payment. The bank payer can be someone else.
                      </p>
                      <input value={searchLeases} onChange={e => setSearchLeases(e.target.value)}
                        placeholder="Search tenant, phone, account reference, unit, or property…"
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 mb-2" />
                      {searchLeases.trim().length < 2 && (
                        <p className="text-xs text-gray-500">                        Enter at least 2 characters to search leases with an outstanding deposit or bill.</p>
                      )}
                      {assignmentLeaseSearch.isFetching && (
                        <p className="text-xs text-gray-500">Searching leases…</p>
                      )}
                      {assignmentLeaseSearch.isError && (
                        <div className="text-xs text-red-600">
                          <p>Could not search leases.</p>
                          <button onClick={() => assignmentLeaseSearch.refetch()} className="mt-1 underline">Try again</button>
                        </div>
                      )}
                      {assignmentLeaseSearch.data?.length === 0 && !assignmentLeaseSearch.isFetching && searchLeases.trim().length >= 2 && (
                        <p className="text-xs text-gray-500">No leases with outstanding balances found for that search.</p>
                      )}
                      {!!assignmentLeaseSearch.data?.length && (
                        <div className="space-y-1">
                          {assignmentLeaseSearch.data.map(l => (
                            <button key={l.id} onClick={() => assign(u.id, l.id)}
                              className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-white border border-transparent hover:border-gray-200 transition">
                              <span className="font-medium text-gray-900">{l.tenant_name}</span>
                              <span className="text-gray-400 ml-2">Unit {l.unit_number} · {l.property_name}</span>
                              <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-500">{l.status}</span>
                              {l.tenant_phone && <span className="block text-xs text-gray-500">{l.tenant_phone}</span>}
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
        <div className="space-y-6">
          <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-800">Imported statements</h2>
            </div>
            {!batches?.length ? (
              <div className="text-center py-10"><p className="text-sm text-gray-400">No imports yet</p></div>
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
          </section>

          <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-800">Resolved transactions</h2>
              <p className="mt-0.5 text-xs text-gray-500">Assigned payments and removed pending entries are retained here.</p>
            </div>
            {!resolutionHistory?.length ? (
              <div className="text-center py-10"><p className="text-sm text-gray-400">No resolved transactions yet</p></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-gray-50 border-b border-gray-100">
                    {['Date','Reference','Payer','Amount','Resolution','Assigned to','Resolved'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {resolutionHistory.map(item => (
                      <tr key={item.id}>
                        <td className="px-4 py-3 text-gray-600">{item.transaction_date ? DATE(item.transaction_date) : '—'}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-600">{item.transaction_ref ?? '—'}</td>
                        <td className="px-4 py-3 text-gray-700">{item.payer_name ?? 'Unknown payer'}</td>
                        <td className="px-4 py-3 font-medium text-gray-900">{KES(item.amount)}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-1 text-xs font-semibold capitalize ${item.resolution === 'assigned' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                            {item.resolution.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {item.tenant_name ? `${item.tenant_name} · Unit ${item.unit_number ?? '—'}${item.property_name ? ` · ${item.property_name}` : ''}` : '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-400">{item.resolved_at ? DATE(item.resolved_at) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}