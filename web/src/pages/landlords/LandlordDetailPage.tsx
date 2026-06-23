// web/src/pages/landlords/LandlordDetailPage.tsx

import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, getApiErrorMessage } from '../../lib/api';
import { toast } from '../../components/ui/toaster';

const C = 'bg-white rounded-2xl border border-gray-100 shadow-sm';
const inputCls = "w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition placeholder-gray-400";

type Tab = 'properties' | 'collections' | 'statements';

// ─── Commission Override Modal ────────────────────────────────────────────────

function CommissionOverrideModal({ landlordId, property, onClose, onSaved }: {
  landlordId: string;
  property: { id: string; name: string; override_commission_type?: string; override_commission_value?: number };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [type,    setType]    = useState(property.override_commission_type  ?? 'percentage');
  const [value,   setValue]   = useState(String(property.override_commission_value ?? ''));
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const hasOverride = !!property.override_commission_type;

  async function save() {
    setLoading(true); setError('');
    try {
      await apiClient.post(`/landlords/${landlordId}/commission-override`, {
        propertyId: property.id,
        commissionType: type,
        commissionValue: parseFloat(value) || 0,
      });
      toast({ title: 'Commission override saved', variant: 'success' });
      onSaved();
    } catch(e: any) { setError(getApiErrorMessage(e)); }
    finally { setLoading(false); }
  }

  async function remove() {
    if (!window.confirm('Remove override? The landlord\'s default rate will apply.')) return;
    setLoading(true);
    try {
      await apiClient.delete(`/landlords/${landlordId}/commission-override/${property.id}`);
      toast({ title: 'Override removed', variant: 'success' });
      onSaved();
    } catch(e: any) { setError(getApiErrorMessage(e)); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6">
        <h3 className="font-bold text-gray-900 mb-1">Commission Override</h3>
        <p className="text-sm text-gray-500 mb-5">{property.name}</p>
        {error && <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Type</label>
            <select value={type} onChange={e => setType(e.target.value)} className={inputCls + ' bg-white'}>
              <option value="percentage">Percentage of collected rent</option>
              <option value="flat">Flat monthly fee (KES)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              {type === 'flat' ? 'Amount (KES)' : 'Rate (%)'}
            </label>
            <input type="number" min={0} value={value} onChange={e => setValue(e.target.value)}
              placeholder={type === 'flat' ? '5000' : '10'} className={inputCls} />
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700">Cancel</button>
          {hasOverride && (
            <button onClick={remove} disabled={loading}
              className="py-2.5 px-4 rounded-xl text-sm font-semibold text-red-700 bg-red-50 hover:bg-red-100 transition">
              Remove
            </button>
          )}
          <button onClick={save} disabled={loading}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg,#0d9f9f,#076666)' }}>
            {loading ? 'Saving…' : 'Save Override'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LandlordDetailPage() {
  const { id }   = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc       = useQueryClient();
  const [tab, setTab]                 = useState<Tab>('properties');
  const [overrideProperty, setOverrideProperty] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['landlord', id],
    queryFn: () => apiClient.get(`/landlords/${id}`).then((r: any) => r.data.data),
    enabled: !!id,
  });

  const { data: statements } = useQuery({
    queryKey: ['landlord-statements', id],
    queryFn: () => apiClient.get('/remittances', { params: { landlordId: id } }).then((r: any) => r.data.data.statements),
    enabled: tab === 'statements' && !!id,
  });

  const landlord   = data?.landlord;
  const properties = data?.properties ?? [];
  const monthStats = data?.monthStats;

  if (isLoading) return (
    <div className="flex justify-center items-center h-64">
      <div className="w-7 h-7 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!landlord) return (
    <div className="p-8 text-center text-gray-500">Landlord not found</div>
  );

  return (
    <div className="p-6 lg:p-8 space-y-6">

      {/* Back */}
      <button onClick={() => navigate('/landlords')}
        className="flex items-center gap-2 text-sm font-medium text-teal-600 hover:text-teal-700 transition">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        Back to Landlord Clients
      </button>

      {/* Header card */}
      <div className={`${C} p-6`}>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900">{landlord.full_name}</h1>
              {landlord.has_portal_access && (
                <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                  ✅ Portal Active
                </span>
              )}
              <span className="text-xs font-semibold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full">
                {landlord.commission_type === 'percentage'
                  ? `${landlord.commission_value}% commission`
                  : `KES ${Number(landlord.commission_value).toLocaleString()} flat`}
              </span>
            </div>
            <div className="flex items-center gap-4 mt-1.5 text-sm text-gray-500 flex-wrap">
              {landlord.phone && <span>{landlord.phone}</span>}
              {landlord.email && <span>{landlord.email}</span>}
              {landlord.kra_pin && <span>KRA: {landlord.kra_pin}</span>}
            </div>
            {landlord.bank_name && (
              <p className="text-sm text-gray-500 mt-1">
                🏦 {landlord.bank_name} — {landlord.bank_account ?? 'No account number'}
              </p>
            )}
          </div>
        </div>

        {/* This month summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 pt-5 border-t border-gray-100">
          {[
            { label: 'Properties',     value: properties.length },
            { label: 'Total Units',    value: properties.reduce((s: number, p: any) => s + Number(p.unit_count), 0) },
            { label: 'Billed (month)', value: `KES ${Number(monthStats?.total_billed ?? 0).toLocaleString()}` },
            { label: 'Collected',      value: `KES ${Number(monthStats?.total_collected ?? 0).toLocaleString()}` },
          ].map(s => (
            <div key={s.label}>
              <p className="text-xs text-gray-400">{s.label}</p>
              <p className="font-bold text-gray-900 mt-0.5">{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {([
          { k: 'properties',  label: '🏢 Properties' },
          { k: 'collections', label: '💰 Collections' },
          { k: 'statements',  label: '📄 Statements' },
        ] as const).map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              tab === t.k ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Properties Tab */}
      {tab === 'properties' && (
        <div className={`${C} overflow-hidden`}>
          {properties.length === 0 ? (
            <div className="p-10 text-center text-gray-400 text-sm">No properties assigned to this landlord yet.</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100">
                  <th className="px-5 py-3">Property</th>
                  <th className="px-5 py-3 text-center">Units</th>
                  <th className="px-5 py-3 text-center">Occupied</th>
                  <th className="px-5 py-3 text-center">Occupancy</th>
                  <th className="px-5 py-3">Commission</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {properties.map((p: any) => (
                  <tr key={p.id} className="hover:bg-gray-50 transition">
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-gray-900 text-sm">{p.name}</p>
                      {p.address && <p className="text-xs text-gray-400">{p.address}</p>}
                    </td>
                    <td className="px-5 py-3.5 text-center text-sm text-gray-600">{p.unit_count}</td>
                    <td className="px-5 py-3.5 text-center text-sm text-gray-600">{p.occupied_units}</td>
                    <td className="px-5 py-3.5 text-center">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        (p.occupied_units / Math.max(p.unit_count, 1)) >= 0.8
                          ? 'bg-green-50 text-green-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}>
                        {p.unit_count > 0 ? Math.round(p.occupied_units / p.unit_count * 100) : 0}%
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-600">
                      {p.override_commission_type ? (
                        <span className="text-purple-700 font-medium">
                          {p.override_commission_type === 'percentage'
                            ? `${p.override_commission_value}% (override)`
                            : `KES ${Number(p.override_commission_value).toLocaleString()} flat (override)`}
                        </span>
                      ) : (
                        <span className="text-gray-400">Landlord default</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <button onClick={() => setOverrideProperty(p)}
                        className="text-xs font-semibold text-teal-700 hover:text-teal-800 transition">
                        {p.override_commission_type ? 'Edit' : 'Set Override'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Collections Tab */}
      {tab === 'collections' && (
        <div className={`${C} overflow-hidden`}>
          {properties.length === 0 ? (
            <div className="p-10 text-center text-gray-400 text-sm">No properties to show collections for.</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100">
                  <th className="px-5 py-3">Property</th>
                  <th className="px-5 py-3 text-right">Units</th>
                  <th className="px-5 py-3 text-right">Billed</th>
                  <th className="px-5 py-3 text-right">Collected</th>
                  <th className="px-5 py-3 text-right">Outstanding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {properties.map((p: any) => (
                  <tr key={p.id} className="hover:bg-gray-50 transition">
                    <td className="px-5 py-3.5 font-medium text-sm text-gray-900">{p.name}</td>
                    <td className="px-5 py-3.5 text-right text-sm text-gray-600">{p.occupied_units}/{p.unit_count}</td>
                    <td className="px-5 py-3.5 text-right text-sm text-gray-600">
                      KES {Number(monthStats?.total_billed ?? 0).toLocaleString()}
                    </td>
                    <td className="px-5 py-3.5 text-right text-sm font-semibold text-emerald-700">
                      KES {Number(monthStats?.total_collected ?? 0).toLocaleString()}
                    </td>
                    <td className="px-5 py-3.5 text-right text-sm font-semibold text-red-600">
                      KES {Math.max(0, Number(monthStats?.total_billed ?? 0) - Number(monthStats?.total_collected ?? 0)).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Statements Tab */}
      {tab === 'statements' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => navigate(`/remittances?landlordId=${id}`)}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(135deg,#0d9f9f,#076666)' }}>
              Generate Statement
            </button>
          </div>
          {!statements?.length ? (
            <div className={`${C} p-10 text-center text-gray-400 text-sm`}>
              No remittance statements yet. Generate the first one above.
            </div>
          ) : (
            <div className={`${C} overflow-hidden`}>
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100">
                    <th className="px-5 py-3">Period</th>
                    <th className="px-5 py-3 text-right">Gross</th>
                    <th className="px-5 py-3 text-right">Commission</th>
                    <th className="px-5 py-3 text-right">Net Payable</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {statements.map((s: any) => {
                    const STATUS: Record<string, { bg: string; text: string; label: string }> = {
                      draft: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Draft' },
                      sent:  { bg: 'bg-blue-50',  text: 'text-blue-700', label: 'Sent' },
                      paid:  { bg: 'bg-green-50', text: 'text-green-700', label: 'Paid' },
                    };
                    const st = STATUS[s.status] ?? STATUS.draft;
                    const month = new Date(s.period_month).toLocaleString('en-KE', { month: 'long', year: 'numeric' });
                    return (
                      <tr key={s.id} className="hover:bg-gray-50 transition">
                        <td className="px-5 py-3.5 font-medium text-sm text-gray-900">
                          {month}
                          {s.dispute_flag && <span className="ml-2 text-xs font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">⚠️ Dispute</span>}
                        </td>
                        <td className="px-5 py-3.5 text-right text-sm text-gray-600">KES {Number(s.gross_collected).toLocaleString()}</td>
                        <td className="px-5 py-3.5 text-right text-sm text-gray-600">KES {Number(s.commission_amount).toLocaleString()}</td>
                        <td className="px-5 py-3.5 text-right text-sm font-bold text-teal-700">KES {Number(s.net_payable).toLocaleString()}</td>
                        <td className="px-5 py-3.5">
                          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${st.bg} ${st.text}`}>{st.label}</span>
                        </td>
                        <td className="px-5 py-3.5">
                          <button onClick={() => navigate(`/remittances`)}
                            className="text-xs font-semibold text-teal-600 hover:text-teal-700">View</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {overrideProperty && (
        <CommissionOverrideModal
          landlordId={id!}
          property={overrideProperty}
          onClose={() => setOverrideProperty(null)}
          onSaved={() => { setOverrideProperty(null); qc.invalidateQueries({ queryKey: ['landlord', id] }); }}
        />
      )}
    </div>
  );
}