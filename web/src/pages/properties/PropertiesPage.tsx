// web/src/pages/properties/PropertiesPage.tsx

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, getApiErrorMessage } from '../../lib/api';

interface Property {
  id: string; name: string; address: string | null; county: string | null;
  description: string | null; total_units: number | null; is_active: boolean;
  unit_count: string; occupied_count: string; vacant_count: string; created_at: string;
}
interface PropertyFormData {
  name: string; address: string; county: string; description: string; totalUnits: string;
}

const COUNTIES = ['Nairobi','Mombasa','Kisumu','Nakuru','Eldoret','Thika','Malindi',
  'Kitale','Garissa','Kakamega','Nyeri','Meru','Embu','Machakos','Kilifi','Kwale',
  'Kajiado',"Murang'a",'Kirinyaga','Nyandarua','Laikipia','Samburu','Trans-Nzoia',
  'Uasin Gishu','Elgeyo-Marakwet','Nandi','Baringo','Kericho','Bomet','Siaya','Kisii',
  'Nyamira','Migori','Homa Bay','Bungoma','Busia','Vihiga','Tana River','Lamu',
  'Taita-Taveta','Makueni','Kitui','Tharaka-Nithi','Isiolo','Marsabit','Wajir',
  'Mandera','Turkana','West Pokot'];

const EMPTY: PropertyFormData = { name:'', address:'', county:'', description:'', totalUnits:'' };
const inputCls = "w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition placeholder-gray-400";

// ─── OccupancyBar ─────────────────────────────────────────────────────────────
function OccupancyBar({ occupied, total }: { occupied: number; total: number }) {
  const pct   = total > 0 ? Math.round((occupied / total) * 100) : 0;
  const color = pct >= 90 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#ef4444';
  return (
    <div className="mt-3">
      <div className="flex justify-between mb-1">
        <span className="text-xs text-gray-400">Occupancy</span>
        <span className="text-xs font-semibold" style={{ color }}>{pct}%</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width:`${pct}%`, backgroundColor:color }} />
      </div>
    </div>
  );
}

// ─── PropertyCard ─────────────────────────────────────────────────────────────
function PropertyCard({ p, onEdit, onDelete, onClick }: {
  p: Property; onEdit:(p:Property)=>void; onDelete:(p:Property)=>void; onClick:(p:Property)=>void;
}) {
  const units    = parseInt(p.unit_count)    || 0;
  const occupied = parseInt(p.occupied_count)|| 0;
  const vacant   = parseInt(p.vacant_count)  || 0;
  return (
    <div onClick={() => onClick(p)}
      className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md hover:border-gray-200 transition-all cursor-pointer group overflow-hidden">
      <div className="h-1.5" style={{ background: p.is_active ? 'linear-gradient(90deg,#0d9f9f,#076666)' : '#e5e7eb' }} />
      <div className="p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background:'linear-gradient(135deg,#e6fafa,#b2eded)' }}>
              <svg className="w-5 h-5" style={{ color:'#0d9f9f' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21" />
              </svg>
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-gray-900 truncate group-hover:text-teal-600 transition-colors">{p.name}</h3>
              {(p.address || p.county) && (
                <p className="text-xs text-gray-400 mt-0.5 truncate">{[p.address,p.county].filter(Boolean).join(', ')}</p>
              )}
            </div>
          </div>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" onClick={e=>e.stopPropagation()}>
            <button onClick={()=>onEdit(p)} className="p-1.5 rounded-lg text-gray-400 hover:text-teal-600 hover:bg-teal-50 transition">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
              </svg>
            </button>
            <button onClick={()=>onDelete(p)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          {[{l:'Units',v:units,c:'bg-gray-50 text-gray-700'},{l:'Occupied',v:occupied,c:'bg-emerald-50 text-emerald-700'},{l:'Vacant',v:vacant,c:'bg-amber-50 text-amber-700'}].map(s=>(
            <div key={s.l} className={`flex flex-col items-center justify-center px-4 py-2 rounded-lg ${s.c}`}>
              <span className="text-lg font-bold leading-none">{s.v}</span>
              <span className="text-xs mt-0.5 opacity-75">{s.l}</span>
            </div>
          ))}
        </div>
        {units > 0 && <OccupancyBar occupied={occupied} total={units} />}
      </div>
    </div>
  );
}

// ─── Property Modal ───────────────────────────────────────────────────────────
function PropertyModal({ editing, onClose, onSaved }: { editing:Property|null; onClose:()=>void; onSaved:()=>void }) {
  const [form, setForm] = useState<PropertyFormData>(editing
    ? { name:editing.name, address:editing.address??'', county:editing.county??'', description:editing.description??'', totalUnits:editing.total_units?.toString()??'' }
    : EMPTY);
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(false);
  const set = (k: keyof PropertyFormData, v: string) => setForm(f=>({...f,[k]:v}));

  async function submit() {
    if (!form.name.trim()) { setError('Property name is required'); return; }
    setError(''); setLoading(true);
    try {
      const payload = { name:form.name.trim(), address:form.address||null, county:form.county||null,
        description:form.description||null, totalUnits:form.totalUnits?parseInt(form.totalUnits):null };
      editing ? await apiClient.patch(`/properties/${editing.id}`, payload)
              : await apiClient.post('/properties', payload);
      onSaved();
    } catch(e) { setError(getApiErrorMessage(e)); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:'rgba(0,0,0,0.4)', backdropFilter:'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">{editing ? 'Edit Property' : 'Add Property'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-6 space-y-4">
          {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Property Name *</label>
            <input value={form.name} onChange={e=>set('name',e.target.value)} placeholder="Sunrise Apartments" className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">County</label>
              <select value={form.county} onChange={e=>set('county',e.target.value)} className={inputCls+' bg-white'}>
                <option value="">Select…</option>
                {COUNTIES.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Total Units</label>
              <input type="number" min={1} value={form.totalUnits} onChange={e=>set('totalUnits',e.target.value)} placeholder="12" className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Address</label>
            <input value={form.address} onChange={e=>set('address',e.target.value)} placeholder="Off Ngong Road, Nairobi" className={inputCls} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
            <textarea value={form.description} onChange={e=>set('description',e.target.value)} rows={2}
              placeholder="Optional notes…" className={inputCls+' resize-none'} />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition">Cancel</button>
          <button onClick={submit} disabled={loading}
            className="px-5 py-2 rounded-lg text-sm font-semibold text-white transition disabled:opacity-60 flex items-center gap-2"
            style={{ background:'#0d9f9f' }}>
            {loading && <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
            {editing ? 'Save Changes' : 'Create Property'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Delete Modal ─────────────────────────────────────────────────────────────
function DeleteModal({ p, onClose, onDeleted }: { p:Property; onClose:()=>void; onDeleted:()=>void }) {
  const [loading,setLoading] = useState(false);
  const [error,setError]     = useState('');
  async function del() {
    setLoading(true); setError('');
    try { await apiClient.delete(`/properties/${p.id}`); onDeleted(); }
    catch(e) { setError(getApiErrorMessage(e)); setLoading(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:'rgba(0,0,0,0.4)', backdropFilter:'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900">Delete "{p.name}"?</h3>
            <p className="text-sm text-gray-500 mt-1">Properties with active leases cannot be deleted.</p>
          </div>
        </div>
        {error && <div className="mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition">Cancel</button>
          <button onClick={del} disabled={loading}
            className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition disabled:opacity-60 flex items-center gap-2">
            {loading && <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function PropertiesPage() {
  const navigate  = useNavigate();
  const qc        = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editing,   setEditing]   = useState<Property | null>(null);
  const [deleting,  setDeleting]  = useState<Property | null>(null);
  const [search,    setSearch]    = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['properties'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { properties: Property[] } }>('/properties');
      return res.data.data.properties;
    },
  });

  function refresh() { qc.invalidateQueries({ queryKey:['properties'] }); setShowModal(false); setEditing(null); setDeleting(null); }

  const props = (data??[]).filter(p => !search ||
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.address??'').toLowerCase().includes(search.toLowerCase()) ||
    (p.county??'').toLowerCase().includes(search.toLowerCase()));

  const totalUnits    = (data??[]).reduce((s,p)=>s+parseInt(p.unit_count||'0'),0);
  const totalOccupied = (data??[]).reduce((s,p)=>s+parseInt(p.occupied_count||'0'),0);
  const totalVacant   = (data??[]).reduce((s,p)=>s+parseInt(p.vacant_count||'0'),0);

  return (
    <div className="p-6 lg:p-8 ">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Properties</h1>
          <p className="text-sm text-gray-500 mt-0.5">{data ? `${data.length} ${data.length===1?'property':'properties'}` : 'Loading…'}</p>
        </div>
        <button onClick={()=>{ setEditing(null); setShowModal(true); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm hover:shadow-md transition"
          style={{ background:'linear-gradient(135deg,#0d9f9f,#076666)' }}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add Property
        </button>
      </div>

      {/* Summary */}
      {data && data.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[{l:'Total Units',v:totalUnits,e:'🏢',b:'bg-blue-50',t:'text-blue-700'},
            {l:'Occupied',v:totalOccupied,e:'✅',b:'bg-emerald-50',t:'text-emerald-700'},
            {l:'Vacant',v:totalVacant,e:'🔑',b:'bg-amber-50',t:'text-amber-700'}].map(s=>(
            <div key={s.l} className={`${s.b} rounded-2xl p-4 flex items-center gap-4`}>
              <span className="text-2xl">{s.e}</span>
              <div><p className={`text-2xl font-bold ${s.t}`}>{s.v}</p><p className="text-xs text-gray-500">{s.l}</p></div>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      {data && data.length > 0 && (
        <div style={{ position:'relative', marginBottom:'1.5rem' }}>
          <svg style={{ position:'absolute', left:'0.875rem', top:'50%', transform:'translateY(-50%)', width:'1rem', height:'1rem', color:'#9ca3af', pointerEvents:'none' }}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search properties…"
            style={{ width:'100%', paddingLeft:'2.5rem', paddingRight:'1rem', paddingTop:'0.625rem', paddingBottom:'0.625rem',
              borderRadius:'0.75rem', border:'1px solid #e5e7eb', fontSize:'0.875rem', outline:'none', background:'white' }}
            onFocus={e=>{ e.target.style.boxShadow='0 0 0 2px #0d9f9f'; e.target.style.borderColor='transparent'; }}
            onBlur={e=>{ e.target.style.boxShadow='none'; e.target.style.borderColor='#e5e7eb'; }} />
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor:'#0d9f9f', borderTopColor:'transparent' }} />
        </div>
      )}

      {/* Error */}
      {error && <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">Failed to load properties.</div>}

      {/* Empty */}
      {!isLoading && data && data.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background:'linear-gradient(135deg,#e6fafa,#b2eded)' }}>
            <svg className="w-8 h-8" style={{ color:'#0d9f9f' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-gray-900 mb-1">No properties yet</h3>
          <p className="text-sm text-gray-500 mb-5">Add your first property to get started</p>
          <button onClick={()=>{ setEditing(null); setShowModal(true); }} className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background:'#0d9f9f' }}>
            Add First Property
          </button>
        </div>
      )}

      {/* Grid */}
      {!isLoading && props.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {props.map(p=>(
            <PropertyCard key={p.id} p={p}
              onClick={prop=>navigate(`/properties/${prop.id}`)}
              onEdit={prop=>{ setEditing(prop); setShowModal(true); }}
              onDelete={prop=>setDeleting(prop)} />
          ))}
        </div>
      )}

      {/* Modals */}
      {(showModal || editing) && (
        <PropertyModal editing={editing} onClose={()=>{ setShowModal(false); setEditing(null); }} onSaved={refresh} />
      )}
      {deleting && <DeleteModal p={deleting} onClose={()=>setDeleting(null)} onDeleted={refresh} />}
    </div>
  );
}