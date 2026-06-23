// web/src/pages/portal/PortalHome.tsx

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiClient } from '../../lib/api';
import { useAuthStore } from '../../stores/authStore';

function kes(n: number | string | null | undefined) {
  const v = parseFloat(String(n ?? 0));
  return `KES ${v.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmt(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_STYLE: Record<string, string> = {
  paid:    'bg-green-100 text-green-700',
  partial: 'bg-amber-100 text-amber-700',
  open:    'bg-blue-100 text-blue-700',
  overdue: 'bg-red-100 text-red-700',
};

const CHANNEL_LABEL: Record<string, string> = {
  mpesa_stk:    'M-Pesa (STK)',
  mpesa_paybill:'M-Pesa Paybill',
  cash:         'Cash',
  bank_transfer:'Bank Transfer',
  manual:       'Manual',
};

export default function PortalHome() {
  const { user } = useAuthStore();

  const { data: meData, isLoading } = useQuery({
    queryKey: ['portal-me'],
    queryFn: () => apiClient.get('/portal/me').then(r => r.data.data),
  });

  const { data: billsData } = useQuery({
    queryKey: ['portal-bills', 1],
    queryFn: () => apiClient.get('/portal/bills?per_page=3').then(r => r.data.data),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: '#0d9f9f', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  const tenant = meData?.tenant;
  const recentBills: any[] = billsData?.bills ?? [];
  const hasOutstanding = recentBills.some((b: any) => ['open','partial','overdue'].includes(b.status));

  return (
    <div className="space-y-4">
      {/* Welcome */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">
          Hello, {user?.fullName?.split(' ')[0]} 👋
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {tenant?.property_name} · Unit {tenant?.unit_number}
        </p>
      </div>

      {/* Outstanding alert */}
      {hasOutstanding && (
        <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-red-800">You have outstanding bills</p>
            <Link to="/portal/bills" className="text-sm text-red-600 underline">View and pay now →</Link>
          </div>
        </div>
      )}

      {/* Lease card */}
      {tenant?.lease_id ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Your Lease</p>
          </div>
          <div className="p-5 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Property</p>
              <p className="text-sm font-semibold text-gray-900">{tenant.property_name}</p>
              <p className="text-xs text-gray-500">{tenant.property_address}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Unit</p>
              <p className="text-sm font-semibold text-gray-900">{tenant.unit_number}</p>
              <p className="text-xs text-gray-500 capitalize">{tenant.unit_type?.replace('_',' ') ?? ''}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Monthly Rent</p>
              <p className="text-sm font-bold text-teal-700">{kes(tenant.monthly_rent)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Lease Status</p>
              <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-semibold
                ${tenant.lease_status === 'active' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                {tenant.lease_status === 'active' ? 'Active' : 'Notice Period'}
              </span>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Start Date</p>
              <p className="text-sm text-gray-700">{fmt(tenant.start_date)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">
                {tenant.end_date ? 'End Date' : 'Lease Type'}
              </p>
              <p className="text-sm text-gray-700">{tenant.end_date ? fmt(tenant.end_date) : 'Rolling (no fixed end)'}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-gray-50 rounded-2xl border border-dashed border-gray-200 p-6 text-center">
          <p className="text-sm text-gray-500">No active lease found.</p>
        </div>
      )}

      {/* How to pay */}
      {tenant?.snap_payment_method && (
        <div className="bg-teal-50 rounded-2xl border border-teal-100 p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-teal-600 mb-3">How to Pay</p>
          {tenant.snap_payment_method === 'mpesa_paybill' || tenant.snap_payment_method === 'bank_paybill' ? (
            <div className="space-y-1">
              <p className="text-sm text-gray-700">
                <span className="font-semibold">Paybill:</span> {tenant.snap_paybill_number}
              </p>
              <p className="text-sm text-gray-700">
                <span className="font-semibold">Account:</span>{' '}
                <span className="font-mono bg-white px-2 py-0.5 rounded border border-teal-100">{tenant.snap_account_reference}</span>
              </p>
              <p className="text-xs text-gray-500 mt-2">
                Use your unit account reference exactly as shown above when making payment.
              </p>
            </div>
          ) : tenant.snap_payment_method === 'cash' ? (
            <p className="text-sm text-gray-700">Pay cash to your property manager. Ask for a receipt.</p>
          ) : (
            <p className="text-sm text-gray-700">
              Payment method: {CHANNEL_LABEL[tenant.snap_payment_method] ?? tenant.snap_payment_method}
            </p>
          )}
        </div>
      )}

      {/* Recent bills */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-bold text-gray-700">Recent Bills</p>
          <Link to="/portal/bills" className="text-xs text-teal-600 font-medium hover:underline">View all →</Link>
        </div>
        {recentBills.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-400">No bills yet</div>
        ) : (
          <div className="space-y-2">
            {recentBills.map((bill: any) => (
              <Link key={bill.id} to={`/portal/bills/${bill.id}`}
                className="block bg-white rounded-xl border border-gray-100 px-4 py-3 hover:border-teal-200 transition">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {new Date(bill.for_month).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' })}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">Due {fmt(bill.due_date)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-gray-900">{kes(bill.total_amount)}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_STYLE[bill.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {bill.status.charAt(0).toUpperCase() + bill.status.slice(1)}
                    </span>
                  </div>
                </div>
                {bill.total_due > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-50 flex justify-between text-xs text-gray-500">
                    <span>Paid: {kes(bill.total_paid)}</span>
                    <span className="text-red-600 font-medium">Outstanding: {kes(bill.total_due)}</span>
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Contact */}
      {tenant?.company_phone && (
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2">Contact Management</p>
          <p className="text-sm text-gray-700">{tenant.company_name_display}</p>
          <a href={`tel:${tenant.company_phone}`} className="text-sm text-teal-600 font-medium">{tenant.company_phone}</a>
        </div>
      )}
    </div>
  );
}