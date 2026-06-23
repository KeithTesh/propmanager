// web/src/pages/properties/PropertyDetailPage.tsx

import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, getApiErrorMessage } from '../../lib/api';
import { toast } from '../../components/ui/toaster';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Property {
  id: string; name: string; address: string | null; county: string | null;
  description: string | null; total_units: number | null; is_active: boolean;
  unit_count: string; occupied_count: string; vacant_count: string;
}

interface Unit {
  id: string; unit_number: string; unit_type: string | null;
  floor_number: number | null; size_sqm: string | null;
  bedrooms: number | null; bathrooms: number | null;
  is_occupied: boolean; is_active: boolean; notes: string | null;
  lease_id: string | null; monthly_rent: string | null;
  lease_status: string | null; tenant_name: string | null; tenant_phone: string | null;
}

interface UnitFormData {
  unitNumber: string; unitType: string; floorNumber: string;
  sizeSqm: string; bedrooms: string; bathrooms: string; notes: string;
}

const UNIT_TYPES = ['bedsitter','studio','1br','2br','3br','4br','commercial','other'];
const TYPE_LABELS: Record<string, string> = {
  bedsitter:'Bedsitter', studio:'Studio', '1br':'1 Bedroom', '2br':'2 Bedroom',
  '3br':'3 Bedroom', '4br':'4 Bedroom', commercial:'Commercial', other:'Other',
};
const EMPTY_FORM: UnitFormData = { unitNumber:'', unitType:'', floorNumber:'', sizeSqm:'', bedrooms:'', bathrooms:'', notes:'' };
const inputCls = "w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition placeholder-gray-400";

// ─── Unit Card ────────────────────────────────────────────────────────────────

function UnitCard({ unit, onEdit, onArchive }: {
  unit: Unit; onEdit:(u:Unit)=>void; onArchive:(u:Unit)=>void;
}) {
  const occupied = unit.is_occupied;
  return (
    <div className={`bg-white rounded-xl border-2 transition-all group overflow-hidden
      ${occupied ? 'border-emerald-100' : 'border-gray-100 hover:border-gray-200'}`}>
      {/* Top indicator */}
      <div className={`h-1 w-full ${occupied ? 'bg-emerald-400' : 'bg-gray-200'}`} />
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-gray-900">Unit {unit.unit_number}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium
                ${occupied ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                {occupied ? 'Occupied' : 'Vacant'}
              </span>
            </div>
            {unit.unit_type && (
              <p className="text-xs text-gray-400 mt-0.5">{TYPE_LABELS[unit.unit_type] ?? unit.unit_type}</p>
            )}
          </div>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={()=>onEdit(unit)} className="p-1.5 rounded-lg text-gray-400 hover:text-teal-600 hover:bg-teal-50 transition">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
              </svg>
            </button>
            {!occupied && (
              <button onClick={()=>onArchive(unit)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Tenant info */}
        {occupied && unit.tenant_name && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-teal-100 flex items-center justify-center text-xs font-bold text-teal-700">
                {unit.tenant_name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-gray-800 truncate">{unit.tenant_name}</p>
                {unit.tenant_phone && <p className="text-xs text-gray-400">{unit.tenant_phone}</p>}
              </div>
            </div>
            {unit.monthly_rent && (
              <p className="text-xs font-semibold text-teal-700 mt-2">
                KES {parseInt(unit.monthly_rent).toLocaleString()}/mo
              </p>
            )}
          </div>
        )}

        {/* Unit specs */}
        {(unit.bedrooms !== null || unit.bathrooms !== null || unit.floor_number !== null) && (
          <div className="flex gap-3 mt-3 pt-3 border-t border-gray-100">
            {unit.floor_number !== null && (
              <span className="text-xs text-gray-400">Floor {unit.floor_number}</span>
            )}
            {unit.bedrooms !== null && (
              <span className="text-xs text-gray-400">{unit.bedrooms}bd</span>
            )}
            {unit.bathrooms !== null && (
              <span className="text-xs text-gray-400">{unit.bathrooms}ba</span>
            )}
            {unit.size_sqm && (
              <span className="text-xs text-gray-400">{parseFloat(unit.size_sqm)}m²</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Unit Modal ───────────────────────────────────────────────────────────────

function UnitModal({ propertyId, editing, onClose, onSaved }: {
  propertyId: string; editing: Unit | null; onClose:()=>void; onSaved:()=>void;
}) {
  const [form, setForm] = useState<UnitFormData>(editing ? {
    unitNumber:  editing.unit_number,
    unitType:    editing.unit_type ?? '',
    floorNumber: editing.floor_number?.toString() ?? '',
    sizeSqm:     editing.size_sqm ? parseFloat(editing.size_sqm).toString() : '',
    bedrooms:    editing.bedrooms?.toString() ?? '',
    bathrooms:   editing.bathrooms?.toString() ?? '',
    notes:       editing.notes ?? '',
  } : EMPTY_FORM);
  const [tab,     setTab]     = useState<'single'|'bulk'>('single');
  const [bulk,    setBulk]    = useState({ prefix:'', from:'1', to:'10', unitType:'' });
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const set = (k: keyof UnitFormData, v: string) => setForm(f=>({...f,[k]:v}));

  async function submitSingle() {
    if (!form.unitNumber.trim()) { setError('Unit number is required'); return; }
    setError(''); setLoading(true);
    try {
      const payload = {
        propertyId,
        unitNumber:  form.unitNumber.trim(),
        unitType:    form.unitType || null,
        floorNumber: form.floorNumber ? parseInt(form.floorNumber) : null,
        sizeSqm:     form.sizeSqm ? parseFloat(form.sizeSqm) : null,
        bedrooms:    form.bedrooms ? parseInt(form.bedrooms) : null,
        bathrooms:   form.bathrooms ? parseInt(form.bathrooms) : null,
        notes:       form.notes || null,
      };
      if (editing) {
        await apiClient.patch(`/units/${editing.id}`, payload);
      } else {
        const res = await apiClient.post('/units', payload);
        // Check for unit limit warning header
        const warning = res.headers?.['x-unit-limit-warning'];
        if (warning) {
          toast({ title: '⚠️ Approaching unit limit', description: warning, variant: 'info', duration: 6000 });
        }
      }
      onSaved();
    } catch(e: any) {
      // Handle unit limit reached specifically
      if (e?.response?.data?.error?.code === 'UNIT_LIMIT_REACHED') {
        setError(e.response.data.error.message);
        toast({
          title: '🚫 Unit limit reached',
          description: 'Upgrade your plan to add more units. Go to Settings → Subscription.',
          variant: 'error',
          duration: 8000,
        });
      } else {
        setError(getApiErrorMessage(e));
      }
    }
    finally { setLoading(false); }
  }

  async function submitBulk() {
    if (!bulk.from || !bulk.to) { setError('Please enter from and to numbers'); return; }
    setError(''); setLoading(true);
    try {
      const res = await apiClient.post<{ data: { created: number } }>('/units/bulk', {
        propertyId,
        prefix:   bulk.prefix,
        from:     parseInt(bulk.from),
        to:       parseInt(bulk.to),
        unitType: bulk.unitType || null,
      });
      const { created } = res.data.data;
      const warning = res.headers?.['x-unit-limit-warning'];
      if (warning) {
        toast({ title: '⚠️ Approaching unit limit', description: warning, variant: 'info', duration: 6000 });
      }
      if (created === 0) setError('All unit numbers already exist — no new units created');
      else onSaved();
    } catch(e: any) {
      if (e?.response?.data?.error?.code === 'UNIT_LIMIT_REACHED') {
        setError(e.response.data.error.message);
        toast({ title: '🚫 Unit limit reached', description: 'Upgrade your plan to add more units.', variant: 'error', duration: 8000 });
      } else {
        setError(getApiErrorMessage(e));
      }
    }
    finally { setLoading(false); }
  }

  const preview = (() => {
    const from = parseInt(bulk.from), to = parseInt(bulk.to);
    if (!isNaN(from) && !isNaN(to) && to >= from) {
      const nums = Array.from({ length: Math.min(to - from + 1, 5) }, (_, i) => `${bulk.prefix}${from + i}`);
      if (to - from + 1 > 5) nums.push('…');
      return nums.join(', ');
    }
    return null;
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:'rgba(0,0,0,0.4)', backdropFilter:'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">{editing ? 'Edit Unit' : 'Add Unit'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs — only for new units */}
        {!editing && (
          <div className="flex border-b border-gray-100">
            {(['single','bulk'] as const).map(t => (
              <button key={t} onClick={()=>{ setTab(t); setError(''); }}
                className={`flex-1 py-3 text-sm font-medium transition border-b-2
                  ${tab===t ? 'border-teal-500 text-teal-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                {t === 'single' ? 'Single Unit' : 'Bulk Create'}
              </button>
            ))}
          </div>
        )}

        <div className="p-6 space-y-4">
          {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}

          {(tab === 'single' || editing) ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Unit Number *</label>
                  <input value={form.unitNumber} onChange={e=>set('unitNumber',e.target.value)}
                    placeholder="A1, 101, Shop 2…" className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Unit Type</label>
                  <select value={form.unitType} onChange={e=>set('unitType',e.target.value)} className={inputCls+' bg-white'}>
                    <option value="">Select…</option>
                    {UNIT_TYPES.map(t=><option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Floor</label>
                  <input type="number" value={form.floorNumber} onChange={e=>set('floorNumber',e.target.value)} placeholder="0" className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Bedrooms</label>
                  <input type="number" min={0} value={form.bedrooms} onChange={e=>set('bedrooms',e.target.value)} placeholder="1" className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Bathrooms</label>
                  <input type="number" min={0} value={form.bathrooms} onChange={e=>set('bathrooms',e.target.value)} placeholder="1" className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Size (m²)</label>
                <input type="number" min={0} step={0.5} value={form.sizeSqm} onChange={e=>set('sizeSqm',e.target.value)} placeholder="35" className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes</label>
                <textarea value={form.notes} onChange={e=>set('notes',e.target.value)} rows={2}
                  placeholder="Optional notes…" className={inputCls+' resize-none'} />
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-500">Create multiple numbered units at once. Unit numbers will be <span className="font-medium text-gray-700">prefix + number</span>.</p>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Prefix</label>
                  <input value={bulk.prefix} onChange={e=>setBulk(b=>({...b,prefix:e.target.value}))}
                    placeholder="A, B, Unit…" className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">From #</label>
                  <input type="number" min={1} value={bulk.from} onChange={e=>setBulk(b=>({...b,from:e.target.value}))}
                    placeholder="1" className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">To #</label>
                  <input type="number" min={1} value={bulk.to} onChange={e=>setBulk(b=>({...b,to:e.target.value}))}
                    placeholder="10" className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Unit Type (all units)</label>
                <select value={bulk.unitType} onChange={e=>setBulk(b=>({...b,unitType:e.target.value}))} className={inputCls+' bg-white'}>
                  <option value="">Select…</option>
                  {UNIT_TYPES.map(t=><option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                </select>
              </div>
              {preview && (
                <div className="p-3 rounded-xl bg-teal-50 border border-teal-100">
                  <p className="text-xs text-teal-700"><span className="font-semibold">Preview:</span> {preview}</p>
                  <p className="text-xs text-teal-600 mt-0.5">
                    {Math.max(0, parseInt(bulk.to||'0') - parseInt(bulk.from||'0') + 1)} units will be created
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition">Cancel</button>
          <button onClick={tab==='bulk' && !editing ? submitBulk : submitSingle} disabled={loading}
            className="px-5 py-2 rounded-lg text-sm font-semibold text-white transition disabled:opacity-60 flex items-center gap-2"
            style={{ background:'#0d9f9f' }}>
            {loading && <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
            {editing ? 'Save Changes' : tab === 'bulk' ? 'Create Units' : 'Add Unit'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Archive Confirm ──────────────────────────────────────────────────────────

function ArchiveModal({ unit, onClose, onDone }: { unit:Unit; onClose:()=>void; onDone:()=>void }) {
  const [loading,setLoading] = useState(false);
  const [error,setError]     = useState('');
  async function archive() {
    setLoading(true); setError('');
    try { await apiClient.delete(`/units/${unit.id}`); onDone(); }
    catch(e) { setError(getApiErrorMessage(e)); setLoading(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:'rgba(0,0,0,0.4)', backdropFilter:'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-2">Archive Unit {unit.unit_number}?</h3>
        <p className="text-sm text-gray-500">This unit will be hidden but its history will be preserved.</p>
        {error && <div className="mt-3 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
        <div className="flex justify-end gap-3 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition">Cancel</button>
          <button onClick={archive} disabled={loading}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition disabled:opacity-60 flex items-center gap-2">
            {loading && <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
            Archive
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PropertyDetailPage() {
  const { id }    = useParams<{ id: string }>();
  const navigate  = useNavigate();
  const qc        = useQueryClient();
  const [showUnit,  setShowUnit]  = useState(false);
  const [editing,   setEditing]   = useState<Unit | null>(null);
  const [archiving, setArchiving] = useState<Unit | null>(null);
  const [filter,    setFilter]    = useState<'all'|'occupied'|'vacant'>('all');

  const { data: property, isLoading: propLoading } = useQuery({
    queryKey: ['property', id],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { property: Property } }>(`/properties/${id}`);
      return res.data.data.property;
    },
  });

  // Fetch company unit limit info for banner
  const { data: limitInfo } = useQuery({
    queryKey: ['company-unit-limit'],
    queryFn: () => apiClient.get('/companies/me/limit').then((r: any) => r.data.data).catch(() => null),
    staleTime: 60_000,
  });

  const { data: units, isLoading: unitsLoading } = useQuery({
    queryKey: ['units', id],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { units: Unit[] } }>(`/units?propertyId=${id}`);
      return res.data.data.units;
    },
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ['units', id] });
    qc.invalidateQueries({ queryKey: ['property', id] });
    qc.invalidateQueries({ queryKey: ['properties'] });
    setShowUnit(false); setEditing(null); setArchiving(null);
  }

  const filtered = (units ?? []).filter(u =>
    filter === 'all' ? true : filter === 'occupied' ? u.is_occupied : !u.is_occupied
  );

  const occupied = (units ?? []).filter(u => u.is_occupied).length;
  const vacant   = (units ?? []).filter(u => !u.is_occupied).length;
  const total    = (units ?? []).length;
  const pct      = total > 0 ? Math.round((occupied / total) * 100) : 0;

  return (
    <div className="p-6 lg:p-8 ">

      {/* Back */}
      <button onClick={()=>navigate('/properties')}
        className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition mb-6">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        Back to Properties
      </button>

      {propLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor:'#0d9f9f', borderTopColor:'transparent' }} />
        </div>
      ) : property ? (
        <>
      {/* Unit limit banner */}
          {limitInfo && limitInfo.units_used >= limitInfo.unit_limit && (
            <div className="mb-4 p-4 rounded-xl border flex items-center gap-3"
              style={{ background:'#fee2e2', borderColor:'#fca5a5' }}>
              <span className="text-xl">🚫</span>
              <div className="flex-1">
                <p className="text-sm font-bold text-red-800">Unit limit reached — {limitInfo.units_used}/{limitInfo.unit_limit} units used</p>
                <p className="text-xs text-red-700 mt-0.5">You cannot add more units on your current plan. <a href="/settings?tab=subscription" className="underline font-semibold">Upgrade your plan →</a></p>
              </div>
            </div>
          )}
          {limitInfo && limitInfo.units_used < limitInfo.unit_limit && limitInfo.units_used / limitInfo.unit_limit >= 0.8 && (
            <div className="mb-4 p-4 rounded-xl border flex items-center gap-3"
              style={{ background:'#fef3c7', borderColor:'#fcd34d' }}>
              <span className="text-xl">⚠️</span>
              <div className="flex-1">
                <p className="text-sm font-bold text-amber-800">Approaching unit limit — {limitInfo.units_used}/{limitInfo.unit_limit} units used</p>
                <p className="text-xs text-amber-700 mt-0.5">Consider upgrading your plan before you hit the limit. <a href="/settings?tab=subscription" className="underline font-semibold">View plans →</a></p>
              </div>
            </div>
          )}

          {/* Property header */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background:'linear-gradient(135deg,#e6fafa,#b2eded)' }}>
                  <svg className="w-6 h-6" style={{ color:'#0d9f9f' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900">{property.name}</h1>
                  {(property.address || property.county) && (
                    <p className="text-sm text-gray-400 mt-0.5">
                      {[property.address, property.county].filter(Boolean).join(', ')}
                    </p>
                  )}
                  {property.description && (
                    <p className="text-sm text-gray-500 mt-1">{property.description}</p>
                  )}
                </div>
              </div>
              <button onClick={()=>{ setEditing(null); setShowUnit(true); }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white shrink-0"
                style={{ background:'linear-gradient(135deg,#0d9f9f,#076666)' }}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add Unit
              </button>
            </div>

            {/* Occupancy summary */}
            <div className="grid grid-cols-4 gap-4 mt-6 pt-5 border-t border-gray-100">
              {[
                { l:'Total Units', v:total,    c:'text-gray-900' },
                { l:'Occupied',    v:occupied, c:'text-emerald-600' },
                { l:'Vacant',      v:vacant,   c:'text-amber-600' },
                { l:'Occupancy',   v:`${pct}%`,c:pct>=80?'text-emerald-600':pct>=50?'text-amber-600':'text-red-500' },
              ].map(s=>(
                <div key={s.l} className="text-center">
                  <p className={`text-2xl font-bold ${s.c}`}>{s.v}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{s.l}</p>
                </div>
              ))}
            </div>

            {/* Occupancy bar */}
            {total > 0 && (
              <div className="mt-4">
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{ width:`${pct}%`, background:'linear-gradient(90deg,#0d9f9f,#076666)' }} />
                </div>
              </div>
            )}
          </div>

          {/* Filter tabs */}
          {total > 0 && (
            <div className="flex gap-2 mb-5">
              {(['all','occupied','vacant'] as const).map(f=>(
                <button key={f} onClick={()=>setFilter(f)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition capitalize
                    ${filter===f ? 'bg-teal-500 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'}`}
                  style={filter===f ? { background:'#0d9f9f' } : {}}>
                  {f === 'all' ? `All (${total})` : f === 'occupied' ? `Occupied (${occupied})` : `Vacant (${vacant})`}
                </button>
              ))}
            </div>
          )}

          {/* Units grid */}
          {unitsLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor:'#0d9f9f', borderTopColor:'transparent' }} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background:'linear-gradient(135deg,#e6fafa,#b2eded)' }}>
                <svg className="w-7 h-7" style={{ color:'#0d9f9f' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-gray-900 mb-1">
                {filter === 'all' ? 'No units yet' : `No ${filter} units`}
              </h3>
              {filter === 'all' && (
                <p className="text-sm text-gray-400 mb-4">Add units one by one or use bulk create</p>
              )}
              {filter === 'all' && (
                <button onClick={()=>{ setEditing(null); setShowUnit(true); }}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{ background:'#0d9f9f' }}>
                  Add First Unit
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {filtered.map(u=>(
                <UnitCard key={u.id} unit={u}
                  onEdit={unit=>{ setEditing(unit); setShowUnit(true); }}
                  onArchive={unit=>setArchiving(unit)} />
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-20 text-gray-400">Property not found</div>
      )}

      {/* Modals */}
      {(showUnit || editing) && id && (
        <UnitModal propertyId={id} editing={editing}
          onClose={()=>{ setShowUnit(false); setEditing(null); }}
          onSaved={refresh} />
      )}
      {archiving && <ArchiveModal unit={archiving} onClose={()=>setArchiving(null)} onDone={refresh} />}
    </div>
  );
}