import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, getApiErrorMessage } from '../../lib/api';

interface PropertyOption {
  id: string;
  name: string;
  total_units: number | null;
  unit_count: string | number;
}

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

interface AddUnitModalProps {
  properties: PropertyOption[];
  onClose: () => void;
  onSaved: () => void;
}

function AddUnitModal({ properties, onClose, onSaved }: AddUnitModalProps) {
  const availableProperties = useMemo(() => properties.filter(property =>
    property.total_units === null || Number(property.unit_count) < property.total_units
  ), [properties]);
  const [propertyId, setPropertyId] = useState(availableProperties[0]?.id ?? '');
  const [unitNumber, setUnitNumber] = useState('');
  const [unitType, setUnitType] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const selectedProperty = availableProperties.find(property => property.id === propertyId);
  const remainingUnits = selectedProperty?.total_units === null || !selectedProperty
    ? null
    : selectedProperty.total_units - Number(selectedProperty.unit_count);

  useEffect(() => {
    if (!availableProperties.some(property => property.id === propertyId)) {
      setPropertyId(availableProperties[0]?.id ?? '');
    }
  }, [availableProperties, propertyId]);

  async function submit() {
    if (!propertyId) { setError('Select a property with available unit spaces.'); return; }
    if (!unitNumber.trim()) { setError('Unit number is required.'); return; }
    setSaving(true);
    setError('');
    try {
      await apiClient.post('/units', {
        propertyId,
        unitNumber: unitNumber.trim(),
        unitType: unitType || null,
      });
      onSaved();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">Add Unit</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">✕</button>
        </div>
        <div className="p-6 space-y-4">
          {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Property *</label>
            <select value={propertyId} onChange={event => setPropertyId(event.target.value)}
              disabled={!availableProperties.length}
              className="w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm bg-white disabled:bg-gray-50">
              {availableProperties.map(property => (
                <option key={property.id} value={property.id}>
                  {property.name} ({property.unit_count}{property.total_units === null ? '' : `/${property.total_units}`} units)
                </option>
              ))}
            </select>
            {selectedProperty && remainingUnits !== null && (
              <p className="text-xs text-gray-500 mt-1">{remainingUnits} unit{remainingUnits === 1 ? '' : 's'} remaining for this property.</p>
            )}
            {!availableProperties.length && (
              <p className="text-xs text-amber-700 mt-1">All properties have reached their configured unit limit.</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Unit Number *</label>
              <input value={unitNumber} onChange={event => setUnitNumber(event.target.value)}
                placeholder="A1, 101, Shop 2…" className="w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Unit Type</label>
              <select value={unitType} onChange={event => setUnitType(event.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500">
                <option value="">Select…</option>
                {Object.entries(UNIT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 p-6 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100">Cancel</button>
          <button onClick={submit} disabled={saving || !availableProperties.length}
            className="px-5 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: '#0d9f9f' }}>
            {saving ? 'Adding…' : 'Add Unit'}
          </button>
        </div>
      </div>
    </div>
  );
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
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'occupied' | 'vacant'>('all');
  const [showAddUnit, setShowAddUnit] = useState(false);

  const { data: units, isLoading, error } = useQuery({
    queryKey: ['units-directory'],
    queryFn: async () => {
      const response = await apiClient.get<{ data: { units: Unit[] } }>('/units');
      return response.data.data.units;
    },
  });

  const { data: properties, isLoading: propertiesLoading, error: propertiesError } = useQuery({
    queryKey: ['properties'],
    queryFn: async () => {
      const response = await apiClient.get<{ data: { properties: PropertyOption[] } }>('/properties');
      return response.data.data.properties;
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
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/properties')} className="text-sm font-semibold text-teal-700 hover:text-teal-800">
            Manage Properties
          </button>
          <button onClick={() => setShowAddUnit(true)} disabled={propertiesLoading || !!propertiesError || !properties?.length}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg,#0d9f9f,#076666)' }}>
            Add Unit
          </button>
        </div>
      </div>
      {propertiesError && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
          Could not load properties for unit creation: {getApiErrorMessage(propertiesError)}
        </div>
      )}

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
          <p className="text-sm text-gray-500 mt-1">Add units here and choose the property they belong to.</p>
          <button onClick={() => setShowAddUnit(true)} disabled={!properties?.length}
            className="mt-4 text-sm font-semibold text-teal-700 hover:text-teal-800 disabled:opacity-50">
            Add a unit →
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
      {showAddUnit && properties && (
        <AddUnitModal properties={properties}
          onClose={() => setShowAddUnit(false)}
          onSaved={() => {
            setShowAddUnit(false);
            queryClient.invalidateQueries({ queryKey: ['units-directory'] });
            queryClient.invalidateQueries({ queryKey: ['units'] });
            queryClient.invalidateQueries({ queryKey: ['units-vacant'] });
            queryClient.invalidateQueries({ queryKey: ['properties'] });
            queryClient.invalidateQueries({ queryKey: ['landlords'] });
            queryClient.invalidateQueries({ queryKey: ['landlord'] });
          }} />
      )}
    </div>
  );
}
