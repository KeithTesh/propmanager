// web/src/pages/portal/PortalBillDetail.tsx

import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';

function kes(n: any) {
  return `KES ${parseFloat(String(n ?? 0)).toLocaleString('en-KE', { minimumFractionDigits: 0 })}`;
}
function fmt(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtTime(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const STATUS_CHIP: Record<string, string> = {
  paid: 'bg-green-100 text-green-700',
  partial: 'bg-amber-100 text-amber-700',
  open: 'bg-blue-100 text-blue-700',
  overdue: 'bg-red-100 text-red-700',
};

const CHANNEL_LABEL: Record<string, string> = {
  mpesa_stk: 'M-Pesa (STK Push)', mpesa_paybill: 'M-Pesa Paybill',
  cash: 'Cash', bank_transfer: 'Bank Transfer', adjustment: 'Adjustment',
};

export default function PortalBillDetail() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['portal-bill', id],
    queryFn: () => apiClient.get(`/portal/bills/${id}`).then(r => r.data.data.bill),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-7 h-7 border-2 border-t-transparent rounded-full animate-spin"
          style={{ borderColor: '#0d9f9f', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 mb-3">Bill not found.</p>
        <Link to="/portal/bills" className="text-teal-600 text-sm">← Back to bills</Link>
      </div>
    );
  }

  const bill = data;
  const payments: any[] = bill.payments ?? [];
  const lineItems: any[] = bill.line_items ?? [];
  const monthLabel = new Date(bill.for_month).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
  const isPaid = bill.status === 'paid';

  return (
    <div className="space-y-4">
      {/* Back */}
      <Link to="/portal/bills" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        Back to bills
      </Link>

      {/* Header */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-gray-400 uppercase font-bold tracking-wide">
              {bill.bill_type === 'rent' ? 'Monthly Rent' : bill.bill_type.charAt(0).toUpperCase() + bill.bill_type.slice(1)} · {monthLabel}
            </p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{kes(bill.total_amount)}</p>
            <p className="text-sm text-gray-500 mt-0.5">Due {fmt(bill.due_date)}</p>
          </div>
          <span className={`text-sm px-3 py-1 rounded-full font-semibold ${STATUS_CHIP[bill.status] ?? 'bg-gray-100 text-gray-600'}`}>
            {bill.status === 'paid' ? 'Paid ✓' : bill.status === 'overdue' ? 'Overdue ⚠' : bill.status.charAt(0).toUpperCase() + bill.status.slice(1)}
          </span>
        </div>

        {/* Payment progress */}
        {bill.total_amount > 0 && (
          <div className="mt-4">
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-teal-500 rounded-full"
                style={{ width: `${Math.min(100, (bill.total_paid / bill.total_amount) * 100)}%` }} />
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>Paid: {kes(bill.total_paid)}</span>
              {bill.total_due > 0 && <span className="text-red-500 font-medium">Outstanding: {kes(bill.total_due)}</span>}
            </div>
          </div>
        )}

        {bill.is_prorated && bill.proration_description && (
          <div className="mt-3 p-3 bg-teal-50 rounded-lg text-xs text-teal-700">
            ℹ️ {bill.proration_description}
          </div>
        )}
      </div>

      {/* Breakdown */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-50">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Bill Breakdown</p>
        </div>
        <div className="divide-y divide-gray-50">
          {bill.rent_amount > 0 && (
            <div className="flex justify-between px-5 py-3 text-sm">
              <span className="text-gray-600">Rent</span>
              <span className="font-medium">{kes(bill.rent_amount)}</span>
            </div>
          )}
          {bill.utility_amount > 0 && (
            <div className="flex justify-between px-5 py-3 text-sm">
              <span className="text-gray-600">Utilities</span>
              <span className="font-medium">{kes(bill.utility_amount)}</span>
            </div>
          )}
          {bill.penalty_amount > 0 && (
            <div className="flex justify-between px-5 py-3 text-sm">
              <span className="text-red-600">Late Payment Penalty</span>
              <span className="font-medium text-red-600">{kes(bill.penalty_amount)}</span>
            </div>
          )}
          {bill.adjustment_amount > 0 && (
            <div className="flex justify-between px-5 py-3 text-sm">
              <span className="text-gray-600">Adjustments / Charges</span>
              <span className="font-medium">{kes(bill.adjustment_amount)}</span>
            </div>
          )}
          {lineItems.map((item: any, i: number) => (
            <div key={i} className="flex justify-between px-5 py-2 text-xs bg-amber-50">
              <span className="text-amber-700">↳ {item.description}</span>
              <span className="font-medium text-amber-700">{kes(item.amount)}</span>
            </div>
          ))}
          <div className="flex justify-between px-5 py-3 text-sm font-bold bg-gray-50">
            <span>Total</span>
            <span>{kes(bill.total_amount)}</span>
          </div>
        </div>
      </div>

      {/* How to pay (only if not fully paid) */}
      {!isPaid && bill.snap_payment_method && (
        <div className="bg-teal-50 border border-teal-100 rounded-2xl p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-teal-600 mb-3">How to Pay</p>
          {(bill.snap_payment_method === 'mpesa_paybill' || bill.snap_payment_method === 'bank_paybill') && bill.snap_paybill_number ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between bg-white rounded-xl border border-teal-100 px-4 py-3">
                <div>
                  <p className="text-xs text-gray-400">Paybill Number</p>
                  <p className="text-xl font-bold text-gray-900 font-mono">{bill.snap_paybill_number}</p>
                </div>
                <svg className="w-8 h-8 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 8.25h3m-3 4.5h3M6.75 12H9m-2.25 4.5H9" />
                </svg>
              </div>
              {bill.snap_account_reference && (
                <div className="bg-white rounded-xl border border-teal-100 px-4 py-3">
                  <p className="text-xs text-gray-400">Account Number</p>
                  <p className="text-xl font-bold text-gray-900 font-mono">{bill.snap_account_reference}</p>
                  <p className="text-xs text-teal-600 mt-1">⚠ Use this exact account number</p>
                </div>
              )}
              <p className="text-xs text-gray-500">
                Go to M-Pesa → Lipa na M-Pesa → Pay Bill. Enter the paybill and account numbers above, then enter the amount: <strong>{kes(bill.total_due)}</strong>
              </p>
            </div>
          ) : bill.snap_payment_method === 'cash' ? (
            <p className="text-sm text-gray-700">
              Pay <strong>{kes(bill.total_due)}</strong> in cash to your property manager and ask for a receipt.
            </p>
          ) : (
            <p className="text-sm text-gray-700">
              Contact your property manager to arrange payment of <strong>{kes(bill.total_due)}</strong>.
            </p>
          )}
        </div>
      )}

      {/* Payments received */}
      {payments.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-50">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Payments Received</p>
          </div>
          <div className="divide-y divide-gray-50">
            {payments.map((p: any) => (
              <div key={p.id} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{kes(p.amount)}</p>
                  <p className="text-xs text-gray-400">
                    {CHANNEL_LABEL[p.channel] ?? p.channel}
                    {p.mpesa_receipt && ` · ${p.mpesa_receipt}`}
                    {p.receipt_number && ` · Receipt #${p.receipt_number}`}
                  </p>
                </div>
                <p className="text-xs text-gray-400">{fmtTime(p.recorded_at)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}