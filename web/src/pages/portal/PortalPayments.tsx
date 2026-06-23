// web/src/pages/portal/PortalPayments.tsx

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';

function kes(n: any) {
  return `KES ${parseFloat(String(n ?? 0)).toLocaleString('en-KE', { minimumFractionDigits: 0 })}`;
}
function fmtTime(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmt(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
}

const CHANNEL_LABEL: Record<string, string> = {
  mpesa_stk: 'M-Pesa STK', mpesa_paybill: 'M-Pesa Paybill',
  cash: 'Cash', bank_transfer: 'Bank Transfer', adjustment: 'Adjustment',
};

const CHANNEL_COLOR: Record<string, string> = {
  mpesa_stk: 'bg-green-100 text-green-700',
  mpesa_paybill: 'bg-green-100 text-green-700',
  cash: 'bg-amber-100 text-amber-700',
  bank_transfer: 'bg-blue-100 text-blue-700',
  adjustment: 'bg-gray-100 text-gray-600',
};

export default function PortalPayments() {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['portal-payments', page],
    queryFn: () => apiClient.get(`/portal/payments?page=${page}&per_page=20`).then(r => r.data),
  });

  const payments: any[] = data?.data?.payments ?? [];
  const meta = data?.meta;

  // Compute total paid
  const totalPaid = payments.reduce((sum: number, p: any) => sum + parseFloat(p.amount ?? 0), 0);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-gray-900">Payment History</h1>

      {/* Summary card */}
      {meta && meta.total > 0 && page === 1 && (
        <div className="bg-teal-50 rounded-2xl border border-teal-100 p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-teal-600 font-bold uppercase tracking-wide">This Page Total</p>
            <p className="text-2xl font-bold text-teal-800">{kes(totalPaid)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-teal-600">{meta.total} payment{meta.total !== 1 ? 's' : ''} total</p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="w-7 h-7 border-2 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: '#0d9f9f', borderTopColor: 'transparent' }} />
        </div>
      ) : payments.length === 0 ? (
        <div className="text-center py-12 text-sm text-gray-400">No payments recorded yet.</div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="divide-y divide-gray-50">
            {payments.map((p: any) => (
              <div key={p.id} className="px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-gray-900">{kes(p.amount)}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CHANNEL_COLOR[p.channel] ?? 'bg-gray-100 text-gray-500'}`}>
                        {CHANNEL_LABEL[p.channel] ?? p.channel}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {p.bill_type?.charAt(0).toUpperCase() + p.bill_type?.slice(1)} bill · {fmt(p.for_month)}
                    </p>
                    {p.mpesa_receipt_number && (
                      <p className="text-xs text-gray-400 font-mono mt-0.5">{p.mpesa_receipt_number}</p>
                    )}
                    {p.receipt_number && (
                      <p className="text-xs text-gray-400 mt-0.5">Receipt #{p.receipt_number}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-gray-400">{fmtTime(p.recorded_at)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pagination */}
      {meta && meta.totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40">
            ← Prev
          </button>
          <span className="px-3 py-1.5 text-sm text-gray-500">{page} / {meta.totalPages}</span>
          <button disabled={page === meta.totalPages} onClick={() => setPage(p => p + 1)}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40">
            Next →
          </button>
        </div>
      )}
    </div>
  );
}