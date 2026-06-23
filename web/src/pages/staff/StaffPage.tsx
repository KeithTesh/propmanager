// web/src/pages/staff/StaffPage.tsx

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, getApiErrorMessage } from '../../lib/api';
import { useAuthStore } from '../../stores/authStore';
import { getRoleLabel } from '../../lib/roles';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Property { id: string; name: string; }

interface StaffMember {
  id: string; full_name: string; email: string; phone: string | null;
  role: 'owner' | 'manager' | 'finance' | 'caretaker';
  is_active: boolean; last_login_at: string | null; created_at: string;
  // caretaker perms
  caretaker_property_ids: string[] | null;
  manager_property_ids: string[] | null;
  can_view_tenants: boolean | null;
  can_view_leases: boolean | null;
  can_view_billing: boolean | null;
  can_view_units: boolean | null;
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner', manager: 'Manager', finance: 'Finance', caretaker: 'Caretaker',
};
const ROLE_COLORS: Record<string, string> = {
  owner:     'bg-purple-100 text-purple-700',
  manager:   'bg-blue-100 text-blue-700',
  finance:   'bg-emerald-100 text-emerald-700',
  caretaker: 'bg-amber-100 text-amber-700',
};

const inputCls = "w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition placeholder-gray-400";

function Avatar({ name, role }: { name: string; role: string }) {
  const colors: Record<string, string> = {
    owner: '#7c3aed', manager: '#2563eb', finance: '#059669', caretaker: '#d97706',
  };
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  return (
    <div style={{ width: 40, height: 40, borderRadius: '50%', background: colors[role] ?? '#0d9f9f',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 14, fontWeight: 700, color: 'white', flexShrink: 0 }}>
      {initials}
    </div>
  );
}

// ─── Staff Card ───────────────────────────────────────────────────────────────

function StaffCard({ s, isOwner, canManage, properties, onReset, onDeactivate, onEditPerms }: {
  s: StaffMember; isOwner: boolean; canManage: boolean; properties: Property[];
  onReset: (s: StaffMember) => void;
  onDeactivate: (s: StaffMember) => void;
  onEditPerms: (s: StaffMember) => void;
}) {
  const assignedProps = properties.filter(p => s.caretaker_property_ids?.includes(p.id));

  return (
    <div className={`bg-white rounded-2xl border shadow-sm transition-all group overflow-hidden ${s.is_active ? 'border-gray-100 hover:shadow-md' : 'border-gray-100 opacity-60'}`}>
      <div className="h-1" style={{ background: s.is_active ? 'linear-gradient(90deg,#0d9f9f,#076666)' : '#e5e7eb' }} />
      <div className="p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar name={s.full_name} role={s.role} />
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 truncate">{s.full_name}</p>
              <p className="text-xs text-gray-400 truncate">{s.email}</p>
            </div>
          </div>

          {/* Action buttons — hover */}
          {/* Actions: owner can manage all non-owners; manager can manage finance+caretaker */}
          {((isOwner && s.role !== 'owner') || (canManage && ['finance','caretaker'].includes(s.role))) && (
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              onClick={e => e.stopPropagation()}>
              {/* Edit perms/properties */}
              {(s.role === 'caretaker' || s.role === 'manager') && isOwner && (
                <button onClick={() => onEditPerms(s)} title="Edit permissions"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                  </svg>
                </button>
              )}
              {/* Reset password */}
              <button onClick={() => onReset(s)} title="Reset password"
                className="p-1.5 rounded-lg text-gray-400 hover:text-orange-500 hover:bg-orange-50 transition">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                </svg>
              </button>
              {/* Deactivate — owner only */}
              {isOwner && s.is_active && (
                <button onClick={() => onDeactivate(s)} title="Deactivate"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Role badge + status */}
        <div className="flex flex-wrap gap-2 mt-3">
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${ROLE_COLORS[s.role]}`}>
            {ROLE_LABELS[s.role]}
          </span>
          {!s.is_active && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
              Inactive
            </span>
          )}
        </div>

        {/* Manager: assigned properties */}
        {s.role === 'manager' && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            {(s.manager_property_ids && s.manager_property_ids.length > 0) ? (
              <div className="flex flex-wrap gap-1">
                {properties.filter(p => s.manager_property_ids!.includes(p.id)).map(p => (
                  <span key={p.id} className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">
                    {p.name}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400 italic">All properties (no restriction)</p>
            )}
          </div>
        )}

        {/* Caretaker: assigned properties */}
        {s.role === 'caretaker' && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            {assignedProps.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {assignedProps.map(p => (
                  <span key={p.id} className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium">
                    {p.name}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400 italic">No properties assigned</p>
            )}
            {/* Permission pills */}
            <div className="flex flex-wrap gap-1 mt-1.5">
              {[
                { key: 'can_view_units',   label: 'Units' },
                { key: 'can_view_tenants', label: 'Tenants' },
                { key: 'can_view_leases',  label: 'Leases' },
                { key: 'can_view_billing', label: 'Billing' },
              ].map(({ key, label }) => (
                (s as any)[key] ? (
                  <span key={key} className="text-xs px-1.5 py-0.5 rounded bg-teal-50 text-teal-600 font-medium">
                    ✓ {label}
                  </span>
                ) : null
              ))}
            </div>
          </div>
        )}

        {/* Last login */}
        <p className="text-xs text-gray-400 mt-3">
          {s.last_login_at
            ? `Last login: ${new Date(s.last_login_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}`
            : 'Never logged in'}
        </p>
      </div>
    </div>
  );
}

// ─── Add Staff Modal ──────────────────────────────────────────────────────────

function AddStaffModal({ properties, onClose, onSaved }: {
  properties: Property[]; onClose: () => void; onSaved: () => void;
}) {
  const [fullName,  setFullName]  = useState('');
  const [email,     setEmail]     = useState('');
  const [phone,     setPhone]     = useState('');
  const [role,      setRole]      = useState<'manager' | 'finance' | 'caretaker'>('manager');
  const [propIds,   setPropIds]   = useState<string[]>([]);
  const [canUnits,   setCanUnits]   = useState(true);
  const [canTenants, setCanTenants] = useState(false);
  const [canLeases,  setCanLeases]  = useState(false);
  const [canBilling, setCanBilling] = useState(false);
  const [error, setError] = useState('');

  const create = useMutation({
    mutationFn: () => apiClient.post('/staff', {
      fullName, email, phone: phone || undefined, role,
      ...(role === 'caretaker' ? {
        propertyIds: propIds, canViewUnits: canUnits,
        canViewTenants: canTenants, canViewLeases: canLeases, canViewBilling: canBilling,
      } : {}),
    }).then(r => r.data.data),
    onSuccess: () => onSaved(),
    onError: (e) => setError(getApiErrorMessage(e)),
  });

  function toggleProp(id: string) {
    setPropIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Add Staff Member</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Full Name *</label>
              <input value={fullName} onChange={e => setFullName(e.target.value)} className={inputCls} placeholder="Jane Kamau" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Email *</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} placeholder="jane@company.com" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Phone</label>
              <input value={phone} onChange={e => setPhone(e.target.value)} className={inputCls} placeholder="+254 700 000 000" />
            </div>
          </div>

          {/* Role selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Role *</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: 'manager',   label: 'Manager',   desc: 'Full access except settings & staff' },
                { value: 'finance',   label: 'Finance',   desc: 'Full financial access, no staff/settings' },
                { value: 'caretaker', label: 'Caretaker', desc: 'Assigned properties + custom permissions' },
              ] as const).map(r => (
                <button key={r.value} onClick={() => setRole(r.value)}
                  className={`p-3 rounded-xl border-2 text-left transition ${role === r.value ? 'border-teal-500 bg-teal-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <p className={`text-sm font-semibold ${role === r.value ? 'text-teal-700' : 'text-gray-800'}`}>{r.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5 leading-snug">{r.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Manager: property assignment */}
          {role === 'manager' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Assign Properties <span className="text-gray-400 font-normal">(optional — leave empty for all)</span></label>
              {properties.length === 0 ? (
                <p className="text-sm text-gray-400 italic">No properties found</p>
              ) : (
                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                  {properties.map(p => (
                    <label key={p.id} className={`flex items-center gap-3 p-2.5 rounded-xl border cursor-pointer transition ${propIds.includes(p.id) ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                      <input type="checkbox" checked={propIds.includes(p.id)} onChange={() => toggleProp(p.id)}
                        className="accent-blue-500 shrink-0" />
                      <span className="text-sm font-medium text-gray-800">{p.name}</span>
                    </label>
                  ))}
                </div>
              )}
              {propIds.length === 0 && <p className="text-xs text-amber-600 mt-1">No selection = access to all properties</p>}
            </div>
          )}

          {/* Caretaker-specific */}
          {role === 'caretaker' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Assigned Properties</label>
                {properties.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No properties found</p>
                ) : (
                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {properties.map(p => (
                      <label key={p.id} className={`flex items-center gap-3 p-2.5 rounded-xl border cursor-pointer transition ${propIds.includes(p.id) ? 'border-teal-400 bg-teal-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                        <input type="checkbox" checked={propIds.includes(p.id)} onChange={() => toggleProp(p.id)}
                          className="accent-teal-500 shrink-0" />
                        <span className="text-sm font-medium text-gray-800">{p.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Permissions within assigned properties</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { state: canUnits,   setter: setCanUnits,   label: 'View Units',   always: true },
                    { state: canTenants, setter: setCanTenants, label: 'View Tenants'  },
                    { state: canLeases,  setter: setCanLeases,  label: 'View Leases'   },
                    { state: canBilling, setter: setCanBilling, label: 'View Billing'  },
                  ].map(({ state, setter, label, always }) => (
                    <label key={label} className={`flex items-center gap-2.5 p-2.5 rounded-xl border cursor-pointer transition ${state ? 'border-teal-400 bg-teal-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                      <input type="checkbox" checked={state} onChange={e => setter(e.target.checked)}
                        className="accent-teal-500 shrink-0" />
                      <span className="text-sm text-gray-700">{label}</span>
                      {always && <span className="text-xs text-teal-500 ml-auto">default</span>}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1.5">Maintenance requests are always accessible for caretakers.</p>
              </div>
            </>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={() => create.mutate()} disabled={create.isPending || !fullName || !email}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition"
            style={{ background: '#0d9f9f' }}>
            {create.isPending ? 'Creating…' : 'Add Staff Member'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit Caretaker Permissions Modal ─────────────────────────────────────────

function EditPermsModal({ s, properties, onClose, onSaved }: {
  s: StaffMember; properties: Property[]; onClose: () => void; onSaved: () => void;
}) {
  const [propIds,    setPropIds]    = useState<string[]>(s.caretaker_property_ids ?? []);
  const [canUnits,   setCanUnits]   = useState(s.can_view_units   ?? true);
  const [canTenants, setCanTenants] = useState(s.can_view_tenants ?? false);
  const [canLeases,  setCanLeases]  = useState(s.can_view_leases  ?? false);
  const [canBilling, setCanBilling] = useState(s.can_view_billing ?? false);
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () => apiClient.patch(`/staff/${s.id}`, {
      propertyIds: propIds, canViewUnits: canUnits,
      canViewTenants: canTenants, canViewLeases: canLeases, canViewBilling: canBilling,
    }),
    onSuccess: () => onSaved(),
    onError: (e) => setError(getApiErrorMessage(e)),
  });

  function toggleProp(id: string) {
    setPropIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">Edit Permissions</h2>
            <p className="text-xs text-gray-500">{s.full_name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Assigned Properties</label>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {properties.map(p => (
                <label key={p.id} className={`flex items-center gap-3 p-2.5 rounded-xl border cursor-pointer transition ${propIds.includes(p.id) ? 'border-teal-400 bg-teal-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                  <input type="checkbox" checked={propIds.includes(p.id)} onChange={() => toggleProp(p.id)}
                    className="accent-teal-500 shrink-0" />
                  <span className="text-sm font-medium text-gray-800">{p.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Permissions</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { state: canUnits,   setter: setCanUnits,   label: 'View Units'   },
                { state: canTenants, setter: setCanTenants, label: 'View Tenants' },
                { state: canLeases,  setter: setCanLeases,  label: 'View Leases'  },
                { state: canBilling, setter: setCanBilling, label: 'View Billing' },
              ].map(({ state, setter, label }) => (
                <label key={label} className={`flex items-center gap-2.5 p-2.5 rounded-xl border cursor-pointer transition ${state ? 'border-teal-400 bg-teal-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                  <input type="checkbox" checked={state} onChange={e => setter(e.target.checked)}
                    className="accent-teal-500 shrink-0" />
                  <span className="text-sm text-gray-700">{label}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1.5">Maintenance is always accessible.</p>
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={() => save.mutate()} disabled={save.isPending}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition"
            style={{ background: '#0d9f9f' }}>
            {save.isPending ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit Manager Properties Modal ───────────────────────────────────────────

function EditManagerPropertiesModal({ s, properties, onClose, onSaved }: {
  s: StaffMember; properties: Property[]; onClose: () => void; onSaved: () => void;
}) {
  const [propIds, setPropIds] = useState<string[]>(s.manager_property_ids ?? []);
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () => apiClient.patch(`/staff/${s.id}`, { propertyIds: propIds }),
    onSuccess: () => onSaved(),
    onError: (e) => setError(getApiErrorMessage(e)),
  });

  function toggleProp(id: string) {
    setPropIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">Assign Properties</h2>
            <p className="text-xs text-gray-500">{s.full_name} · Manager</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-6 space-y-4">
          {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
          <p className="text-sm text-gray-500">Select which properties this manager can access. Leave all unchecked to grant access to all properties.</p>
          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {properties.map(p => (
              <label key={p.id} className={`flex items-center gap-3 p-2.5 rounded-xl border cursor-pointer transition ${propIds.includes(p.id) ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                <input type="checkbox" checked={propIds.includes(p.id)} onChange={() => toggleProp(p.id)}
                  className="accent-blue-500 shrink-0" />
                <span className="text-sm font-medium text-gray-800">{p.name}</span>
              </label>
            ))}
          </div>
          {propIds.length === 0 && (
            <p className="text-xs text-amber-600 bg-amber-50 rounded-xl p-3">
              ⚠ No properties selected — this manager will see all properties.
            </p>
          )}
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={() => save.mutate()} disabled={save.isPending}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition"
            style={{ background: '#2563eb' }}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Reset Password Modal ─────────────────────────────────────────────────────

function ResetStaffPasswordModal({ s, onClose }: { s: StaffMember; onClose: () => void }) {
  const [result, setResult] = useState<{ email: string; tempPassword: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = useMutation({
    mutationFn: () => apiClient.post(`/staff/${s.id}/reset-password`).then(r => r.data.data),
    onSuccess: (data) => setResult(data),
  });

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Reset Password</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-6 space-y-4">
          {!result ? (
            <>
              <p className="text-sm text-gray-600">Reset <strong>{s.full_name}</strong>'s password? A new temporary password will be generated.</p>
              <div className="flex gap-2">
                <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 text-gray-600">Cancel</button>
                <button onClick={() => reset.mutate()} disabled={reset.isPending}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: '#f97316' }}>
                  {reset.isPending ? 'Resetting…' : '🔑 Reset'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Email</p>
                  <p className="text-sm font-mono text-gray-800">{result.email}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">New Temporary Password</p>
                  <div className="flex items-center gap-2">
                    <p className="text-xl font-bold font-mono tracking-widest text-gray-900">{result.tempPassword}</p>
                    <button onClick={() => copy(`Email: ${result.email}\nPassword: ${result.tempPassword}`)}
                      className="ml-auto px-2 py-1 rounded-lg text-xs font-medium bg-white border border-gray-200 hover:bg-gray-50">
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
              </div>
              <p className="text-xs text-amber-600 bg-amber-50 rounded-xl p-3">⚠ Shown only once.</p>
              <button onClick={onClose} className="w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: '#0d9f9f' }}>Done</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Deactivate Confirm Modal ─────────────────────────────────────────────────

function DeactivateModal({ s, onClose, onDone }: { s: StaffMember; onClose: () => void; onDone: () => void }) {
  const deactivate = useMutation({
    mutationFn: () => apiClient.delete(`/staff/${s.id}`),
    onSuccess: onDone,
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <h3 className="text-base font-bold text-gray-900 mb-2">Deactivate {s.full_name}?</h3>
        <p className="text-sm text-gray-500">They will no longer be able to log in. This can be reversed by contacting support.</p>
        {deactivate.isError && <p className="mt-3 text-sm text-red-500">{getApiErrorMessage(deactivate.error)}</p>}
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-xl text-sm font-semibold border border-gray-200 text-gray-600">Cancel</button>
          <button onClick={() => deactivate.mutate()} disabled={deactivate.isPending}
            className="flex-1 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-60">
            {deactivate.isPending ? 'Deactivating…' : 'Deactivate'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function StaffPage() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  const [showAdd,      setShowAdd]      = useState(false);
  const [resetting,    setResetting]    = useState<StaffMember | null>(null);
  const [deactivating, setDeactivating] = useState<StaffMember | null>(null);
  const [editingPerms, setEditingPerms] = useState<StaffMember | null>(null);

  const { data: staffData, isLoading } = useQuery({
    queryKey: ['staff'],
    queryFn: () => apiClient.get('/staff').then(r => r.data.data.staff as StaffMember[]),
  });

  const { data: propsData } = useQuery({
    queryKey: ['properties-simple'],
    queryFn: () => apiClient.get('/properties').then(r => (r.data.data.properties ?? []) as Property[]),
  });

  const staff      = staffData ?? [];
  const properties = propsData ?? [];

  function refresh() {
    qc.invalidateQueries({ queryKey: ['staff'] });
    setShowAdd(false); setResetting(null); setDeactivating(null); setEditingPerms(null);
  }

  const byRole = {
    owner:     staff.filter(s => s.role === 'owner'),
    manager:   staff.filter(s => s.role === 'manager'),
    finance:   staff.filter(s => s.role === 'finance'),
    caretaker: staff.filter(s => s.role === 'caretaker'),
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Staff</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {staff.length} {staff.length === 1 ? 'member' : 'members'}
          </p>
        </div>
        {isOwner && (
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm hover:shadow-md transition"
            style={{ background: 'linear-gradient(135deg,#0d9f9f,#076666)' }}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Staff
          </button>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#0d9f9f', borderTopColor: 'transparent' }} />
        </div>
      )}

      {/* Sections by role */}
      {!isLoading && (
        <div className="space-y-8">
          {([
            { key: 'owner',     label: 'Owner'     },
            { key: 'manager',   label: 'Managers'  },
            { key: 'finance',   label: 'Finance'   },
            { key: 'caretaker', label: 'Caretakers'},
          ] as Array<{ key: keyof typeof byRole; label: string }>).map(({ key, label }) => (
            byRole[key].length > 0 ? (
              <div key={key}>
                <div className="flex items-center gap-3 mb-3">
                  <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide">{label}</h2>
                  <div className="flex-1 h-px bg-gray-100" />
                  <span className="text-xs text-gray-400">{byRole[key].length}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {byRole[key].map(s => (
                    <StaffCard key={s.id} s={s} isOwner={isOwner} canManage={user?.role === 'manager'} properties={properties}
                      onReset={setResetting}
                      onDeactivate={setDeactivating}
                      onEditPerms={setEditingPerms} />
                  ))}
                </div>
              </div>
            ) : null
          ))}
        </div>
      )}

      {/* Modals */}
      {showAdd      && <AddStaffModal properties={properties} onClose={() => setShowAdd(false)} onSaved={refresh} />}
      {resetting    && <ResetStaffPasswordModal s={resetting} onClose={() => setResetting(null)} />}
      {deactivating && <DeactivateModal s={deactivating} onClose={() => setDeactivating(null)} onDone={refresh} />}
      {editingPerms && editingPerms.role === 'caretaker' && <EditPermsModal s={editingPerms} properties={properties} onClose={() => setEditingPerms(null)} onSaved={refresh} />}
      {editingPerms && editingPerms.role === 'manager' && <EditManagerPropertiesModal s={editingPerms} properties={properties} onClose={() => setEditingPerms(null)} onSaved={refresh} />}
    </div>
  );
}