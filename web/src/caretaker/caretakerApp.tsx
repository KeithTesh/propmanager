// web/src/caretaker/CaretakerApp.tsx
// Standalone PWA for caretakers — mobile-first, installable
// Uses the same auth API as the management app

import { useState, useEffect, useRef } from 'react';
import { apiClient, getApiErrorMessage } from '../lib/api';
import { tokenStore } from '../lib/api';
import { PasswordInput } from '../components/ui/PasswordInput';

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface CaretakerUser {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: string;
  company_id: string;
}

interface Property {
  id: string;
  name: string;
  address: string;
  county: string;
  units_count: number;
}

interface Unit {
  id: string;
  unit_number: string;
  unit_type: string;
  floor_number: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  is_occupied: boolean;
  tenant_name: string | null;
  tenant_phone: string | null;
}

interface MaintenanceRequest {
  id: string;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  category: string | null;
  photo_urls: string[];
  reported_at: string;
  updated_at: string;
  property_name: string;
  unit_number: string | null;
  reported_by_name: string | null;
  resolution_notes: string | null;
  property_id: string;
  unit_id: string | null;
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const PRIORITY_STYLE: Record<string, string> = {
  low:    'bg-gray-100 text-gray-600',
  medium: 'bg-blue-50 text-blue-700',
  high:   'bg-amber-50 text-amber-700',
  urgent: 'bg-red-50 text-red-700',
};

const STATUS_STYLE: Record<string, string> = {
  open:        'bg-red-50 text-red-600',
  in_progress: 'bg-blue-50 text-blue-700',
  resolved:    'bg-emerald-50 text-emerald-700',
  closed:      'bg-gray-100 text-gray-500',
};

const CATEGORIES = ['plumbing','electrical','structural','cleaning','security','other'];

// ─── MAIN APP ─────────────────────────────────────────────────────────────────

export default function CaretakerApp() {
  const [user, setUser]           = useState<CaretakerUser | null>(null);
  const [loading, setLoading]     = useState(true);
  const [tab, setTab]             = useState<'home' | 'maintenance' | 'properties' | 'profile'>('home');

  // Check session on mount
  useEffect(() => {
    apiClient.get('/auth/me').then((r: any) => {
      const u = r.data.data.user;
      if (u.role !== 'caretaker') {
        setUser(null);
      } else {
        setUser(u);
      }
    }).catch(() => setUser(null)).finally(() => setLoading(false));
  }, []);

  if (loading) return <Splash />;
  if (!user)   return <Login onLogin={setUser} />;

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', minHeight: '100vh', background: '#f9fafb', display: 'flex', flexDirection: 'column' }}>
      {/* Page content */}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 72 }}>
        {tab === 'home'        && <HomePage user={user} onTabChange={setTab} />}
        {tab === 'maintenance' && <MaintenancePage user={user} />}
        {tab === 'properties'  && <PropertiesPage user={user} />}
        {tab === 'profile'     && <ProfilePage user={user} onLogout={() => setUser(null)} />}
      </div>

      {/* Bottom nav */}
      <nav style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 480, background: 'white', borderTop: '1px solid #f3f4f6', display: 'flex', zIndex: 50 }}>
        {([
          { key: 'home',        label: 'Home',        icon: '🏠' },
          { key: 'maintenance', label: 'Maintenance',  icon: '🔧' },
          { key: 'properties',  label: 'Properties',   icon: '🏢' },
          { key: 'profile',     label: 'Profile',      icon: '👤' },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ flex: 1, padding: '10px 0', border: 'none', background: 'none', cursor: 'pointer',
              color: tab === t.key ? '#0d9f9f' : '#9ca3af', fontSize: 10, fontWeight: tab === t.key ? 700 : 400,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <span style={{ fontSize: 20 }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

// ─── SPLASH ───────────────────────────────────────────────────────────────────

function Splash() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0d9f9f' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🏢</div>
      <p style={{ color: 'white', fontWeight: 700, fontSize: 20 }}>PropManager</p>
      <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, marginTop: 4 }}>Caretaker Portal</p>
    </div>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────

function Login({ onLogin }: { onLogin: (u: CaretakerUser) => void }) {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  async function submit() {
    if (!email || !password) { setError('Enter your email and password'); return; }
    setLoading(true); setError('');
    try {
      const r: any = await apiClient.post('/auth/login', { email, password });
      const { user, accessToken } = r.data.data;
      if (user.role !== 'caretaker') {
        setError('This portal is for caretakers only. Use the management app instead.');
        return;
      }
      tokenStore.set(accessToken);
      onLogin(user);
    } catch (e: any) {
      setError(getApiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 24, background: 'white' }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ width: 64, height: 64, borderRadius: 16, background: 'linear-gradient(135deg,#0d9f9f,#076666)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', fontSize: 28 }}>🏢</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', margin: 0 }}>Welcome back</h1>
        <p style={{ color: '#6b7280', fontSize: 14, margin: '4px 0 0' }}>PropManager Caretaker Portal</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input value={email} onChange={e => setEmail(e.target.value)}
          type="email" placeholder="Email address" autoComplete="email"
          style={inputStyle} />
        <PasswordInput value={password} onChange={e => setPassword(e.target.value)}
          placeholder="Password" autoComplete="current-password"
          onKeyDown={e => e.key === 'Enter' && submit()}
          style={inputStyle} />
        {error && <p style={{ color: '#ef4444', fontSize: 13, margin: 0 }}>{error}</p>}
        <button onClick={submit} disabled={loading}
          style={{ ...btnStyle, background: 'linear-gradient(135deg,#0d9f9f,#076666)', color: 'white', marginTop: 4 }}>
          {loading ? 'Signing in…' : 'Sign In'}
        </button>
      </div>
    </div>
  );
}

// ─── HOME PAGE ────────────────────────────────────────────────────────────────

function HomePage({ user, onTabChange }: { user: CaretakerUser; onTabChange: (t: any) => void }) {
  const [stats, setStats] = useState<{ open: number; in_progress: number; properties: number } | null>(null);

  useEffect(() => {
    Promise.all([
      apiClient.get('/maintenance?limit=200'),
      apiClient.get('/properties'),
    ]).then(([m, p]: any[]) => {
      const reqs = m.data.data.requests ?? [];
      setStats({
        open:        reqs.filter((r: any) => r.status === 'open').length,
        in_progress: reqs.filter((r: any) => r.status === 'in_progress').length,
        properties:  p.data.data.properties?.length ?? 0,
      });
    }).catch(() => {});
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div style={{ padding: 20 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>{greeting},</p>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', margin: '2px 0 0' }}>{user.full_name.split(' ')[0]} 👋</h1>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 24 }}>
        {[
          { label: 'Open',        value: stats?.open        ?? '—', color: '#ef4444' },
          { label: 'In Progress', value: stats?.in_progress ?? '—', color: '#3b82f6' },
          { label: 'Properties',  value: stats?.properties  ?? '—', color: '#0d9f9f' },
        ].map(s => (
          <div key={s.label} style={{ background: 'white', borderRadius: 14, padding: '14px 10px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <p style={{ fontSize: 24, fontWeight: 700, color: s.color, margin: 0 }}>{s.value}</p>
            <p style={{ fontSize: 11, color: '#6b7280', margin: '2px 0 0' }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <h2 style={{ fontSize: 15, fontWeight: 600, color: '#374151', marginBottom: 12 }}>Quick Actions</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <QuickAction icon="🔧" title="New Maintenance Request" subtitle="Log a new issue" onClick={() => onTabChange('maintenance')} />
        <QuickAction icon="🏢" title="View Properties" subtitle="Check your assigned properties" onClick={() => onTabChange('properties')} />
      </div>
    </div>
  );
}

function QuickAction({ icon, title, subtitle, onClick }: { icon: string; title: string; subtitle: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 14, background: 'white', border: 'none', borderRadius: 14, padding: '14px 16px', cursor: 'pointer', textAlign: 'left', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', width: '100%' }}>
      <span style={{ fontSize: 24, width: 40, textAlign: 'center' }}>{icon}</span>
      <div>
        <p style={{ fontWeight: 600, color: '#111827', margin: 0, fontSize: 14 }}>{title}</p>
        <p style={{ color: '#6b7280', margin: '2px 0 0', fontSize: 12 }}>{subtitle}</p>
      </div>
      <span style={{ marginLeft: 'auto', color: '#9ca3af' }}>›</span>
    </button>
  );
}

// ─── MAINTENANCE PAGE ─────────────────────────────────────────────────────────

function MaintenancePage({ user }: { user: CaretakerUser }) {
  const [view, setView]       = useState<'list' | 'new' | 'detail'>('list');
  const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
  const [selected, setSelected] = useState<MaintenanceRequest | null>(null);
  const [loading, setLoading]  = useState(true);
  const [filter, setFilter]    = useState<'all' | 'open' | 'in_progress' | 'resolved'>('all');

  function load() {
    setLoading(true);
    apiClient.get('/maintenance?limit=100').then((r: any) => {
      setRequests(r.data.data.requests ?? []);
    }).catch(() => {}).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const filtered = requests.filter(r => filter === 'all' || r.status === filter);

  if (view === 'new') return <NewRequestForm user={user} onBack={() => { setView('list'); load(); }} />;
  if (view === 'detail' && selected) return <RequestDetail request={selected} onBack={() => { setView('list'); load(); }} onUpdate={r => setSelected(r)} />;

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>Maintenance</h1>
        <button onClick={() => setView('new')} style={{ ...btnStyle, background: '#0d9f9f', color: 'white', padding: '8px 14px', fontSize: 13 }}>+ New</button>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, overflowX: 'auto' }}>
        {(['all','open','in_progress','resolved'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: '6px 12px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
              background: filter === f ? '#0d9f9f' : '#f3f4f6', color: filter === f ? 'white' : '#6b7280' }}>
            {f === 'in_progress' ? 'In Progress' : f.charAt(0).toUpperCase() + f.slice(1)}
            {' '}({requests.filter(r => f === 'all' || r.status === f).length})
          </button>
        ))}
      </div>

      {loading ? <Loader /> : filtered.length === 0 ? (
        <Empty text="No maintenance requests" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(r => (
            <button key={r.id} onClick={() => { setSelected(r); setView('detail'); }}
              style={{ background: 'white', border: 'none', borderRadius: 14, padding: 14, textAlign: 'left', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{r.title}</span>
                <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, ...styleObj(PRIORITY_STYLE[r.priority]) }}>{r.priority}</span>
              </div>
              <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 6px' }}>{r.property_name}{r.unit_number ? ` · Unit ${r.unit_number}` : ''}</p>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, ...styleObj(STATUS_STYLE[r.status]) }}>{r.status.replace('_',' ')}</span>
                <span style={{ fontSize: 11, color: '#9ca3af' }}>{fmtDate(r.reported_at)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── NEW REQUEST FORM ─────────────────────────────────────────────────────────

function NewRequestForm({ onBack }: { user: CaretakerUser; onBack: () => void }) {
  const [properties, setProperties] = useState<Property[]>([]);
  const [units, setUnits]           = useState<Unit[]>([]);
  const [propId, setPropId]         = useState('');
  const [unitId, setUnitId]         = useState('');
  const [title, setTitle]           = useState('');
  const [desc, setDesc]             = useState('');
  const [priority, setPriority]     = useState('medium');
  const [category, setCategory]     = useState('');
  const [photos, setPhotos]         = useState<string[]>([]);
  const [error, setError]           = useState('');
  const [saving, setSaving]         = useState(false);
  const fileRef                     = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiClient.get('/properties').then((r: any) => setProperties(r.data.data.properties ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!propId) { setUnits([]); setUnitId(''); return; }
    apiClient.get(`/units?property_id=${propId}`).then((r: any) => setUnits(r.data.data.units ?? [])).catch(() => {});
  }, [propId]);

  async function addPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPhotos(prev => [...prev, reader.result as string]);
    };
    reader.readAsDataURL(file);
  }

  async function submit() {
    if (!title.trim()) { setError('Enter a title'); return; }
    if (!propId)       { setError('Select a property'); return; }
    setSaving(true); setError('');
    try {
      await apiClient.post('/maintenance', {
        property_id: propId,
        unit_id:     unitId || null,
        title:       title.trim(),
        description: desc.trim() || null,
        priority,
        category:    category || null,
        photo_urls:  photos,
      });
      onBack();
    } catch (e: any) {
      setError(getApiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#0d9f9f', fontWeight: 600, fontSize: 14, cursor: 'pointer', marginBottom: 16, padding: 0 }}>← Back</button>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: '0 0 20px' }}>New Maintenance Request</h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelStyle}>Property *</label>
          <select value={propId} onChange={e => setPropId(e.target.value)} style={inputStyle}>
            <option value="">Select property</option>
            {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {units.length > 0 && (
          <div>
            <label style={labelStyle}>Unit</label>
            <select value={unitId} onChange={e => setUnitId(e.target.value)} style={inputStyle}>
              <option value="">No specific unit</option>
              {units.map(u => <option key={u.id} value={u.id}>Unit {u.unit_number}{u.tenant_name ? ` (${u.tenant_name})` : ''}</option>)}
            </select>
          </div>
        )}

        <div>
          <label style={labelStyle}>Title *</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Leaking tap in bathroom" style={inputStyle} />
        </div>

        <div>
          <label style={labelStyle}>Description</label>
          <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} placeholder="Describe the issue in detail…" style={{ ...inputStyle, resize: 'vertical' as const }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={labelStyle}>Priority</label>
            <select value={priority} onChange={e => setPriority(e.target.value)} style={inputStyle}>
              {['low','medium','high','urgent'].map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase()+p.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Category</label>
            <select value={category} onChange={e => setCategory(e.target.value)} style={inputStyle}>
              <option value="">General</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</option>)}
            </select>
          </div>
        </div>

        {/* Photos */}
        <div>
          <label style={labelStyle}>Photos</label>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={addPhoto} style={{ display: 'none' }} />
          <button onClick={() => fileRef.current?.click()}
            style={{ ...btnStyle, background: '#f3f4f6', color: '#374151', width: '100%' }}>
            📷 Add Photo
          </button>
          {photos.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              {photos.map((p, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img src={p} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8 }} />
                  <button onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                    style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: '#ef4444', color: 'white', border: 'none', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <p style={{ color: '#ef4444', fontSize: 13, margin: 0 }}>{error}</p>}

        <button onClick={submit} disabled={saving}
          style={{ ...btnStyle, background: 'linear-gradient(135deg,#0d9f9f,#076666)', color: 'white', marginTop: 4 }}>
          {saving ? 'Submitting…' : 'Submit Request'}
        </button>
      </div>
    </div>
  );
}

// ─── REQUEST DETAIL ───────────────────────────────────────────────────────────

function RequestDetail({ request, onBack, onUpdate }: { request: MaintenanceRequest; onBack: () => void; onUpdate: (r: MaintenanceRequest) => void }) {
  const [status, setStatus]   = useState(request.status);
  const [notes, setNotes]     = useState(request.resolution_notes ?? '');
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const [photos, setPhotos]   = useState<string[]>(request.photo_urls ?? []);
  const fileRef               = useRef<HTMLInputElement>(null);

  async function addPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const newPhotos = [...photos, reader.result as string];
      setPhotos(newPhotos);
      // Save immediately
      await apiClient.patch(`/maintenance/${request.id}`, { photo_urls: newPhotos }).catch(() => {});
    };
    reader.readAsDataURL(file);
  }

  async function save() {
    setSaving(true); setError('');
    try {
      const r: any = await apiClient.patch(`/maintenance/${request.id}`, {
        status,
        resolution_notes: notes || null,
        photo_urls: photos,
      });
      onUpdate(r.data.data.request);
    } catch (e: any) {
      setError(getApiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#0d9f9f', fontWeight: 600, fontSize: 14, cursor: 'pointer', marginBottom: 16, padding: 0 }}>← Back</button>

      <div style={{ background: 'white', borderRadius: 16, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: 14 }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, color: '#111827', margin: '0 0 8px' }}>{request.title}</h2>
        <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 8px' }}>{request.property_name}{request.unit_number ? ` · Unit ${request.unit_number}` : ''}</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, ...styleObj(PRIORITY_STYLE[request.priority]) }}>{request.priority}</span>
          <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, ...styleObj(STATUS_STYLE[request.status]) }}>{request.status.replace('_',' ')}</span>
          {request.category && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#f3f4f6', color: '#6b7280' }}>{request.category}</span>}
        </div>
        {request.description && <p style={{ fontSize: 13, color: '#374151', margin: '12px 0 0', lineHeight: 1.5 }}>{request.description}</p>}
        <p style={{ fontSize: 11, color: '#9ca3af', margin: '8px 0 0' }}>Reported {fmtDate(request.reported_at)}{request.reported_by_name ? ` by ${request.reported_by_name}` : ''}</p>
      </div>

      {/* Photos */}
      <div style={{ background: 'white', borderRadius: 16, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <p style={{ fontWeight: 600, fontSize: 14, margin: 0, color: '#111827' }}>Photos</p>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={addPhoto} style={{ display: 'none' }} />
          <button onClick={() => fileRef.current?.click()} style={{ background: 'none', border: 'none', color: '#0d9f9f', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>+ Add</button>
        </div>
        {photos.length === 0 ? (
          <p style={{ fontSize: 13, color: '#9ca3af', margin: 0 }}>No photos yet</p>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {photos.map((p, i) => (
              <img key={i} src={p} alt="" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 10 }} />
            ))}
          </div>
        )}
      </div>

      {/* Update status */}
      {request.status !== 'closed' && (
        <div style={{ background: 'white', borderRadius: 16, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <p style={{ fontWeight: 600, fontSize: 14, margin: '0 0 12px', color: '#111827' }}>Update Status</p>
          <select value={status} onChange={e => setStatus(e.target.value as any)} style={{ ...inputStyle, marginBottom: 10 }}>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
          </select>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
            placeholder="Resolution notes (optional)…"
            style={{ ...inputStyle, resize: 'vertical' as const, marginBottom: 10 }} />
          {error && <p style={{ color: '#ef4444', fontSize: 13, margin: '0 0 8px' }}>{error}</p>}
          <button onClick={save} disabled={saving}
            style={{ ...btnStyle, background: 'linear-gradient(135deg,#0d9f9f,#076666)', color: 'white', width: '100%' }}>
            {saving ? 'Saving…' : 'Save Update'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── PROPERTIES PAGE ──────────────────────────────────────────────────────────

function PropertiesPage({ user }: { user: CaretakerUser }) {
  const [properties, setProperties] = useState<Property[]>([]);
  const [selected, setSelected]     = useState<Property | null>(null);
  const [units, setUnits]           = useState<Unit[]>([]);
  const [loadingUnits, setLoadingUnits] = useState(false);
  const [loading, setLoading]       = useState(true);
  const [canViewTenants, setCanViewTenants] = useState(false);

  useEffect(() => {
    Promise.all([
      apiClient.get('/properties'),
      apiClient.get('/staff').catch(() => ({ data: { data: { staff: [] } } })),
    ]).then(([p, s]: any[]) => {
      setProperties(p.data.data.properties ?? []);
      const me = (s?.data?.data?.staff ?? []).find((u: any) => u.id === user.id);
      setCanViewTenants(me?.can_view_tenants ?? false);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  function selectProperty(p: Property) {
    setSelected(p);
    setLoadingUnits(true);
    apiClient.get(`/units?property_id=${p.id}`).then((r: any) => {
      setUnits(r.data.data.units ?? []);
    }).catch(() => {}).finally(() => setLoadingUnits(false));
  }

  if (selected) return (
    <div style={{ padding: 20 }}>
      <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: '#0d9f9f', fontWeight: 600, fontSize: 14, cursor: 'pointer', marginBottom: 16, padding: 0 }}>← Back</button>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: '0 0 4px' }}>{selected.name}</h1>
      <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 20px' }}>{selected.address}</p>

      {loadingUnits ? <Loader /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {units.map(u => (
            <div key={u.id} style={{ background: 'white', borderRadius: 14, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, fontSize: 14, color: '#111827' }}>Unit {u.unit_number}</span>
                <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                  background: u.is_occupied ? '#dcfce7' : '#f3f4f6',
                  color: u.is_occupied ? '#15803d' : '#6b7280' }}>
                  {u.is_occupied ? 'Occupied' : 'Vacant'}
                </span>
              </div>
              <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0' }}>
                {u.unit_type}{u.bedrooms ? ` · ${u.bedrooms}BR` : ''}{u.floor_number !== null ? ` · Floor ${u.floor_number}` : ''}
              </p>
              {canViewTenants && u.tenant_name && (
                <div style={{ marginTop: 8, padding: '8px 10px', background: '#f0fdf4', borderRadius: 8 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: '#166534', margin: 0 }}>👤 {u.tenant_name}</p>
                  {u.tenant_phone && <p style={{ fontSize: 12, color: '#166534', margin: '2px 0 0' }}>📞 {u.tenant_phone}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ padding: 20 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: '0 0 16px' }}>My Properties</h1>
      {loading ? <Loader /> : properties.length === 0 ? <Empty text="No properties assigned" /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {properties.map(p => (
            <button key={p.id} onClick={() => selectProperty(p)}
              style={{ background: 'white', border: 'none', borderRadius: 14, padding: 14, textAlign: 'left', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', width: '100%' }}>
              <p style={{ fontWeight: 600, fontSize: 15, color: '#111827', margin: 0 }}>{p.name}</p>
              <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0' }}>{p.address}</p>
              <p style={{ fontSize: 12, color: '#9ca3af', margin: '2px 0 0' }}>{p.units_count} units</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── PROFILE PAGE ─────────────────────────────────────────────────────────────

function ProfilePage({ user, onLogout }: { user: CaretakerUser; onLogout: () => void }) {
  const [oldPw, setOldPw]   = useState('');
  const [newPw, setNewPw]   = useState('');
  const [msg, setMsg]       = useState('');
  const [error, setError]   = useState('');
  const [saving, setSaving] = useState(false);

  async function changePassword() {
    if (!oldPw || !newPw) { setError('Enter both passwords'); return; }
    if (newPw.length < 8)  { setError('New password must be at least 8 characters'); return; }
    setSaving(true); setError(''); setMsg('');
    try {
      await apiClient.post('/auth/change-password', { currentPassword: oldPw, newPassword: newPw });
      setMsg('Password changed successfully');
      setOldPw(''); setNewPw('');
    } catch (e: any) {
      setError(getApiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    await apiClient.post('/auth/logout', {}).catch(() => {});
    tokenStore.clear();
    onLogout();
  }

  return (
    <div style={{ padding: 20 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: '0 0 20px' }}>Profile</h1>

      <div style={{ background: 'white', borderRadius: 16, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'linear-gradient(135deg,#0d9f9f,#076666)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 18 }}>
            {user.full_name.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase()}
          </div>
          <div>
            <p style={{ fontWeight: 700, fontSize: 16, margin: 0, color: '#111827' }}>{user.full_name}</p>
            <p style={{ fontSize: 13, color: '#6b7280', margin: '2px 0 0' }}>{user.email}</p>
            {user.phone && <p style={{ fontSize: 13, color: '#6b7280', margin: '2px 0 0' }}>{user.phone}</p>}
          </div>
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: '#f0fdf4', color: '#166534' }}>Caretaker</span>
      </div>

      <div style={{ background: 'white', borderRadius: 16, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: 14 }}>
        <p style={{ fontWeight: 600, fontSize: 14, margin: '0 0 12px', color: '#111827' }}>Change Password</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <PasswordInput value={oldPw} onChange={e => setOldPw(e.target.value)} placeholder="Current password" style={inputStyle} />
          <PasswordInput value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="New password (min 8 chars)" style={inputStyle} />
          {error && <p style={{ color: '#ef4444', fontSize: 13, margin: 0 }}>{error}</p>}
          {msg   && <p style={{ color: '#059669', fontSize: 13, margin: 0 }}>{msg}</p>}
          <button onClick={changePassword} disabled={saving}
            style={{ ...btnStyle, background: '#0d9f9f', color: 'white' }}>
            {saving ? 'Saving…' : 'Change Password'}
          </button>
        </div>
      </div>

      <button onClick={logout}
        style={{ ...btnStyle, background: '#fee2e2', color: '#dc2626', width: '100%' }}>
        Sign Out
      </button>
    </div>
  );
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function Loader() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
      <div style={{ width: 32, height: 32, border: '3px solid #e5e7eb', borderTopColor: '#0d9f9f', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af', fontSize: 14 }}>{text}</div>;
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

function styleObj(cls: string): React.CSSProperties {
  const map: Record<string, React.CSSProperties> = {
    'bg-gray-100 text-gray-600':    { background: '#f3f4f6', color: '#4b5563' },
    'bg-blue-50 text-blue-700':     { background: '#eff6ff', color: '#1d4ed8' },
    'bg-amber-50 text-amber-700':   { background: '#fffbeb', color: '#b45309' },
    'bg-red-50 text-red-700':       { background: '#fef2f2', color: '#b91c1c' },
    'bg-red-50 text-red-600':       { background: '#fef2f2', color: '#dc2626' },
    'bg-emerald-50 text-emerald-700':{ background: '#ecfdf5', color: '#047857' },
    'bg-gray-100 text-gray-500':    { background: '#f3f4f6', color: '#6b7280' },
  };
  return map[cls] ?? {};
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '11px 14px', borderRadius: 12, border: '1px solid #e5e7eb',
  fontSize: 14, outline: 'none', boxSizing: 'border-box', background: 'white',
};

const btnStyle: React.CSSProperties = {
  padding: '12px 20px', borderRadius: 12, border: 'none', cursor: 'pointer',
  fontSize: 14, fontWeight: 600, transition: 'opacity 0.15s',
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 5,
};