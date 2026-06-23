// web/src/pages/portal/PortalBills.tsx

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';

function kes(n: any) {
  return `KES ${parseFloat(String(n ?? 0)).toLocaleString('en-KE', { minimumFractionDigits: 0 })}`;
}
function fmt(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_CHIP: Record<string, string> = {
  paid:    'bg-green-100 text-green-700',
  partial: 'bg-amber-100 text-amber-700',
  open:    'bg-blue-100 text-blue-700',
  overdue: 'bg-red-100 text-red-700',
};

const STATUS_LABELS: Record<string, string> = {
  paid: 'Paid', partial: 'Partially Paid', open: 'Unpaid', overdue: 'Overdue',
};

const FILTERS = [
  { label: 'All', value: '' },
  { label: 'Unpaid', value: 'open' },
  { label: 'Overdue', value: 'overdue' },
  { label: 'Partial', value: 'partial' },
  { label: 'Paid', value: 'paid' },
];

export default function PortalBills() {
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['portal-bills', filter, page],
    queryFn: () =>
      apiClient.get(`/portal/bills?status=${filter}&page=${page}&per_page=15`)
        .then(r => r.data),
  });

  const bills: any[] = data?.data?.bills ?? [];
  const meta = data?.meta;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-gray-900">My Bills</h1>

      {/* Filter tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {FILTERS.map(f => (
          <button key={f.value}
            onClick={() => { setFilter(f.value); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition ${
              filter === f.value
                ? 'bg-teal-600 text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="w-7 h-7 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#0d9f9f', borderTopColor: 'transparent' }} />
        </div>
      ) : bills.length === 0 ? (
        <div className="text-center py-12 text-sm text-gray-400">
          {filter ? `No ${STATUS_LABELS[filter]?.toLowerCase()} bills` : 'No bills yet'}
        </div>
      ) : (
        <div className="space-y-2">
          {bills.map((bill: any) => (
            <Link key={bill.id} to={`/portal/bills/${bill.id}`}
              className="block bg-white rounded-2xl border border-gray-100 shadow-sm p-4 hover:border-teal-200 transition">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-base font-bold text-gray-900">
                      {new Date(bill.for_month).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' })}
                    </p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_CHIP[bill.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {STATUS_LABELS[bill.status] ?? bill.status}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Due {fmt(bill.due_date)}
                    {bill.is_prorated && <span className="ml-2 text-teal-600">· Prorated</span>}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-bold text-gray-900">{kes(bill.total_amount)}</p>
                  {bill.total_due > 0 && (
                    <p className="text-xs text-red-500 font-medium">{kes(bill.total_due)} due</p>
                  )}
                </div>
              </div>
              {/* progress bar */}
              {bill.total_amount > 0 && (
                <div className="mt-3">
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-teal-500 rounded-full transition-all"
                      style={{ width: `${Math.min(100, (bill.total_paid / bill.total_amount) * 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-gray-400 mt-1">
                    <span>Paid {kes(bill.total_paid)}</span>
                    <span>{Math.round((bill.total_paid / bill.total_amount) * 100)}%</span>
                  </div>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}

      {/* Pagination */}
      {meta && meta.totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40">
            ← Prev
          </button>
          <span className="px-3 py-1.5 text-sm text-gray-500">
            {page} / {meta.totalPages}
          </span>
          <button disabled={page === meta.totalPages} onClick={() => setPage(p => p + 1)}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40">
            Next →
          </button>
        </div>
      )}
    </div>
  );
}