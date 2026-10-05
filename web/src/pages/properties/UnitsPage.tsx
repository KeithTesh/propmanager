import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient, getApiErrorMessage } from '../../lib/api';

interface Unit {
  id: string;
  unit_number: string;
  unit_type: string | null;
  floor_number: number | null;
  is_occupied: boolean;
  is_active: boolean;
  property_id: string;
  property_name: string;
  landlord_id: string | null;
  landlord_name: string | null;
  tenant_name: string | null;
  monthly_rent: string | null;
}

const UNIT_LABELS: Record<string, string> = {
  bedsitter: 'Bedsitter',
  studio: 'Studio',
  '1br': '1 Bedroom',
  '2br': '2 Bedroom',
  '3br': '3 Bedroom',
  '4br': '4 Bedroom',
  commercial: 'Commercial',
  other: 'Other',
};

export default function UnitsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'occupied' | 'vacant'>('all');

  const { data: units, isLoading, error } = useQuery({
    queryKey: ['units-directory'],
    queryFn: async () => {
      const response = await apiClient.get<{ data: { units: Unit[] } }>('/units');
      return response.data.data.units;
    },
  });

  const filteredUnits = useMemo(() => (units ?? []).filter(unit => {
    const matchesStatus = status === 'all' ||
      (status === 'occupied' ? unit.is_occupied : !unit.is_occupied && unit.is_active);
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || [
      unit.unit_number,
      unit.property_name,
      unit.landlord_name ?? '',
      unit.tenant_name ?? '',
    ].some(value => value.toLowerCase().includes(query));
    return matchesStatus && matchesSearch;
  }), [units, status, search]);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Units</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {units ? `${units.length} ${units.length === 1 ? 'unit' : 'units'} across your properties` : 'View units across your properties'}
          </p>
        </div>
        <button onClick={() => navigate('/properties')}
          className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white"
          style={{ background: 'linear-gradient(135deg,#0d9f9f,#076666)' }}>
          Manage Properties
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <input value={search} onChange={event => setSearch(event.target.value)}
          placeholder="Search unit, property, landlord or tenant…"
          className="flex-1 px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
        <select value={status} onChange={event => setStatus(event.target.value as typeof status)}
          className="px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500">
          <option value="all">All units</option>
          <option value="occupied">Occupied</option>
          <option value="vacant">Vacant</option>
        </select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
          Could not load units: {getApiErrorMessage(error)}
        </div>
      ) : filteredUnits.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <p className="font-semibold text-gray-700">{search || status !== 'all' ? 'No matching units' : 'No units yet'}</p>
          <p className="text-sm text-gray-500 mt-1">Units are managed from their property pages.</p>
          <button onClick={() => navigate('/properties')} className="mt-4 text-sm font-semibold text-teal-700 hover:text-teal-800">
            Go to Properties →
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100">
                  <th className="px-5 py-3">Unit</th>
                  <th className="px-5 py-3">Property</th>
                  <th className="px-5 py-3">Landlord</th>
                  <th className="px-5 py-3">Tenant</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Monthly rent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredUnits.map(unit => (
                  <tr key={unit.id} className="hover:bg-gray-50 transition">
                    <td className="px-5 py-3.5">
                      <p className="font-semibold text-sm text-gray-900">{unit.unit_number}</p>
                      <p className="text-xs text-gray-400">
                        {[unit.unit_type ? UNIT_LABELS[unit.unit_type] ?? unit.unit_type : null,
                          unit.floor_number !== null ? `Floor ${unit.floor_number}` : null]
                          .filter(Boolean).join(' · ') || '—'}
                      </p>
                    </td>
                    <td className="px-5 py-3.5">
                      <button onClick={() => navigate(`/properties/${unit.property_id}`)}
                        className="text-sm font-medium text-teal-700 hover:text-teal-800">
                        {unit.property_name}
                      </button>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-600">
                      {unit.landlord_name ?? <span className="text-gray-400">Unassigned</span>}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-600">{unit.tenant_name ?? '—'}</td>
                    <td className="px-5 py-3.5">
                      <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                        unit.is_occupied ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                      }`}>
                        {unit.is_occupied ? 'Occupied' : unit.is_active ? 'Vacant' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right text-sm text-gray-700">
                      {unit.monthly_rent ? `KES ${Number(unit.monthly_rent).toLocaleString()}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
