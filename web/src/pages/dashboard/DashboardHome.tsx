// web/src/pages/dashboard/DashboardHome.tsx

import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/authStore';
import { apiClient } from '../../lib/api';

interface DashboardStats {
  occupancy: { total_units: string; occupied: string; vacant: string; total_properties: string; };
  revenue: { collected_mtd: string; collected_last_month: string; total_outstanding: string; billed_mtd: string; payment_count_mtd: string; };
  revenueChart: { month_label: string; month_key: string; collected: string; billed: string }[];
  billStatus: { paid: string; partial: string; open: string; overdue: string; waived: string };
  recentPayments: { id: string; amount: string; channel: string; receipt_number: string; recorded_at: string; tenant_name: string; unit_number: string; property_name: string; }[];
  recentLeases: { id: string; status: string; start_date: string; created_at: string; monthly_rent: string; tenant_name: string; unit_number: string; property_name: string; }[];
  maintenanceSummary: { open_count: string; urgent_count: string; unacknowledged: string };
}

const KES_SHORT = (n: string | number) => {
  const v = Number(n);
  if (v >= 1_000_000) return `KES ${(v/1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `KES ${(v/1_000).toFixed(0)}K`;
  return `KES ${v}`;
};
const KES  = (n: string | number) => 'KES ' + Number(n).toLocaleString('en-KE', { maximumFractionDigits: 0 });
const pct  = (a: string|number, b: string|number) => { const t = Number(b); return t===0?0:Math.round((Number(a)/t)*100); };
const ago  = (d: string) => { const m = Math.floor((Date.now()-new Date(d).getTime())/60000); if(m<1)return 'just now'; if(m<60)return `${m}m ago`; const h=Math.floor(m/60); if(h<24)return `${h}h ago`; return `${Math.floor(h/24)}d ago`; };
const CHAN: Record<string,string> = { cash:'Cash', mpesa:'M-Pesa', bank_transfer:'Bank', bank_paybill:'PayBill', daraja_stk:'STK', adjustment:'Adj.' };
const SCOL: Record<string,string> = { active:'#10b981', notice:'#f59e0b', terminated:'#ef4444', draft:'#9ca3af' };

function RevenueChart({ data }: { data: DashboardStats['revenueChart'] }) {
  if (!data.length) return <div className="flex items-center justify-center h-32 text-sm text-gray-400">No payment data yet</div>;
  const maxVal = Math.max(...data.map(d => Math.max(Number(d.collected), Number(d.billed))), 1);
  return (
    <div className="flex items-end gap-2 h-36 pt-2">
      {data.map((d, i) => {
        const cH = Math.max((Number(d.collected)/maxVal)*100, 2);
        const bH = Math.max((Number(d.billed)/maxVal)*100, 2);
        const cur = i === data.length - 1;
        return (
          <div key={d.month_key} className="flex-1 flex flex-col items-center gap-1 group relative">
            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center z-10 pointer-events-none">
              <div className="bg-gray-900 text-white text-xs rounded-lg px-2.5 py-1.5 whitespace-nowrap shadow-xl">
                <p className="font-semibold">{d.month_label}</p>
                <p className="text-emerald-400">Collected: {KES_SHORT(d.collected)}</p>
                <p className="text-gray-300">Billed: {KES_SHORT(d.billed)}</p>
              </div>
              <div className="w-2 h-2 bg-gray-900 rotate-45 -mt-1" />
            </div>
            <div className="w-full flex items-end gap-0.5 h-28">
              <div className="flex-1 rounded-t-sm transition-all duration-500" style={{ height:`${bH}%`, background: cur?'#e0f2fe':'#f1f5f9' }} />
              <div className="flex-1 rounded-t-sm transition-all duration-500" style={{ height:`${cH}%`, background: cur?'linear-gradient(to top,#0d9f9f,#14b8b8)':'linear-gradient(to top,#6ee7b7,#a7f3d0)' }} />
            </div>
            <p className={`text-xs font-medium ${cur?'text-teal-600':'text-gray-400'}`}>{d.month_label}</p>
          </div>
        );
      })}
    </div>
  );
}

function OccupancyDonut({ occupied, total }: { occupied: number; total: number }) {
  const rate = total===0?0:occupied/total;
  const r=38, circ=2*Math.PI*r, dash=circ*rate, gap=circ-dash;
  return (
    <div className="relative flex items-center justify-center w-28 h-28">
      <svg className="w-28 h-28 -rotate-90" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r={r} fill="none" stroke="#f1f5f9" strokeWidth="10" />
        <circle cx="48" cy="48" r={r} fill="none" stroke="url(#dg)" strokeWidth="10"
          strokeDasharray={`${dash} ${gap}`} strokeLinecap="round" style={{transition:'stroke-dasharray 0.8s ease'}} />
        <defs><linearGradient id="dg" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#0d9f9f"/><stop offset="100%" stopColor="#14b8b8"/>
        </linearGradient></defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className="text-2xl font-bold text-gray-900">{Math.round(rate*100)}%</p>
        <p className="text-xs text-gray-400">occupied</p>
      </div>
    </div>
  );
}

function BillStatusBar({ status }: { status: DashboardStats['billStatus'] }) {
  const total = ['paid','partial','open','overdue'].reduce((s,k) => s+Number((status as any)[k]), 0);
  if (!total) return <p className="text-sm text-gray-400">No bills this month</p>;
  const segs = [
    {key:'paid',    label:'Paid',    color:'#10b981', value:Number(status.paid)},
    {key:'partial', label:'Partial', color:'#f59e0b', value:Number(status.partial)},
    {key:'open',    label:'Open',    color:'#3b82f6', value:Number(status.open)},
    {key:'overdue', label:'Overdue', color:'#ef4444', value:Number(status.overdue)},
  ].filter(s => s.value > 0);
  return (
    <div className="space-y-3">
      <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
        {segs.map(s => <div key={s.key} className="rounded-full transition-all duration-500" style={{width:`${(s.value/total)*100}%`,background:s.color}} />)}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {segs.map(s => (
          <div key={s.key} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{background:s.color}} />
            <span className="text-xs text-gray-500">{s.label} <strong className="text-gray-700">{s.value}</strong></span>
          </div>
        ))}
        <span className="text-xs text-gray-400 ml-auto">{total} total</span>
      </div>
    </div>
  );
}

export default function DashboardHome() {
  const { user, company } = useAuthStore();
  const navigate = useNavigate();
  const hour = new Date().getHours();
  const greeting = hour<12?'Good morning':hour<17?'Good afternoon':'Good evening';

  const { data: stats, isLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const res = await apiClient.get<{data: DashboardStats}>('/dashboard/stats');
      return res.data.data;
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const occ = stats?.occupancy;
  const rev = stats?.revenue;
  const totalU   = Number(occ?.total_units ?? 0);
  const occupied = Number(occ?.occupied    ?? 0);
  const vacant   = Number(occ?.vacant      ?? 0);
  const props    = Number(occ?.total_properties ?? 0);
  const mtd      = Number(rev?.collected_mtd       ?? 0);
  const lastMo   = Number(rev?.collected_last_month ?? 0);
  const outstand = Number(rev?.total_outstanding    ?? 0);
  const delta    = lastMo===0 ? null : Math.round(((mtd-lastMo)/lastMo)*100);
  const C        = 'bg-white rounded-2xl border border-gray-100 shadow-sm';

  const kpis = [
    {
      label:'Collected MTD', value: isLoading?'—':KES_SHORT(mtd),
      sub: delta===null?'this month':`${delta>=0?'+':''}${delta}% vs last month`,
      subColor: delta===null?'#9ca3af':delta>=0?'#10b981':'#ef4444',
      accent:'#0d9f9f',
      icon:<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
    },
    {
      label:'Outstanding', value: isLoading?'—':KES_SHORT(outstand),
      sub: `${stats?.billStatus?Number(stats.billStatus.open)+Number(stats.billStatus.partial)+Number(stats.billStatus.overdue):0} unpaid bills`,
      subColor: outstand>0?'#ef4444':'#10b981',
      accent:'#ef4444',
      icon:<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>,
    },
    {
      label:'Occupancy', value: isLoading?'—':`${pct(occupied,totalU)}%`,
      sub: isLoading?'':`${occupied}/${totalU} units · ${vacant} vacant`,
      subColor:'#9ca3af',
      accent: pct(occupied,totalU)>=90?'#10b981':pct(occupied,totalU)>=70?'#f59e0b':'#ef4444',
      icon:<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" /></svg>,
    },
    {
      label:'Open Issues', value: isLoading?'—':String(stats?.maintenanceSummary.open_count??0),
      sub: isLoading?'':`${stats?.maintenanceSummary.urgent_count??0} urgent · ${stats?.maintenanceSummary.unacknowledged??0} unacknowledged`,
      subColor: Number(stats?.maintenanceSummary.urgent_count??0)>0?'#ef4444':'#9ca3af',
      accent:'#7c3aed',
      icon:<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" /></svg>,
    },
  ];

  return (
    <div className="p-6 lg:p-8 space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{greeting}, {user?.fullName?.split(' ')[0]} 👋</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {new Date().toLocaleDateString('en-KE',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}
            {company?.name ? ` · ${company.name}` : ''}
          </p>
        </div>
        <div className="hidden md:flex gap-2">
          {[{label:'New Lease',path:'/leases',icon:'📄'},{label:'Record Payment',path:'/payments',icon:'💳'}].map(a => (
            <button key={a.label} onClick={() => navigate(a.path)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white border border-gray-200 text-gray-600 hover:border-teal-300 hover:text-teal-700 transition">
              <span>{a.icon}</span>{a.label}
            </button>
          ))}
        </div>
      </div>

      {/* Setup banner */}
      {company && !company.setupCompleted && (
        <div className="rounded-2xl p-4 flex items-center gap-4"
          style={{background:'linear-gradient(135deg,#e6fafa,#ccf7f7)',border:'1px solid #99e6e6'}}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-white"
            style={{background:'#0d9f9f'}}>✓</div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-teal-900">Complete your setup</p>
            <p className="text-xs text-teal-700 mt-0.5">Finish configuring your company to unlock all features.</p>
          </div>
          <button onClick={() => navigate('/setup')} className="shrink-0 px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{background:'#0d9f9f'}}>
            Continue →
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(card => (
          <div key={card.label} className={`${C} p-5 relative overflow-hidden`}>
            <div className="absolute top-0 right-0 w-16 h-16 rounded-bl-full opacity-5" style={{background:card.accent}} />
            <div className="flex items-start justify-between mb-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{card.label}</p>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{background:card.accent+'18',color:card.accent}}>
                {card.icon}
              </div>
            </div>
            <p className="text-2xl font-bold text-gray-900">{card.value}</p>
            <p className="text-xs mt-1 font-medium" style={{color:card.subColor}}>{card.sub}</p>
          </div>
        ))}
      </div>

      {/* Revenue chart + Occupancy */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`${C} p-6 lg:col-span-2`}>
          <div className="flex items-center justify-between mb-1">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Revenue — Last 6 Months</h2>
              <p className="text-xs text-gray-400 mt-0.5">Teal = collected · Light = billed</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400">This month</p>
              <p className="text-base font-bold text-gray-900">{KES_SHORT(mtd)}</p>
            </div>
          </div>
          <RevenueChart data={stats?.revenueChart ?? []} />
        </div>

        <div className={`${C} p-6 flex flex-col`}>
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Occupancy</h2>
          <div className="flex items-center justify-between flex-1">
            <OccupancyDonut occupied={occupied} total={totalU} />
            <div className="space-y-3 ml-4">
              {[
                {label:'Total Units',value:totalU,  color:'#e5e7eb'},
                {label:'Occupied',   value:occupied, color:'#0d9f9f'},
                {label:'Vacant',     value:vacant,   color:'#fbbf24'},
                {label:'Properties', value:props,    color:'#7c3aed'},
              ].map(s => (
                <div key={s.label} className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{background:s.color}} />
                  <div>
                    <p className="text-xs text-gray-500">{s.label}</p>
                    <p className="text-sm font-bold text-gray-900">{s.value}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <button onClick={() => navigate('/properties')} className="mt-4 w-full text-xs text-teal-600 font-semibold hover:text-teal-800 transition text-center">
            View properties →
          </button>
        </div>
      </div>

      {/* Bill status + Recent payments */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`${C} p-6`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-900">Bills This Month</h2>
            <button onClick={() => navigate('/billing')} className="text-xs text-teal-600 font-semibold hover:text-teal-800 transition">View all →</button>
          </div>
          <BillStatusBar status={stats?.billStatus ?? {paid:'0',partial:'0',open:'0',overdue:'0',waived:'0'}} />
          {Number(stats?.billStatus.overdue ?? 0) > 0 && (
            <div className="mt-4 p-3 rounded-xl bg-red-50 border border-red-100 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-red-500 shrink-0 animate-pulse" />
              <p className="text-xs text-red-700 font-medium">
                {stats?.billStatus.overdue} overdue bill{Number(stats?.billStatus.overdue)>1?'s':''} — action needed
              </p>
            </div>
          )}
        </div>

        <div className={`${C} p-6 lg:col-span-2`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-900">Recent Payments</h2>
            <button onClick={() => navigate('/payments')} className="text-xs text-teal-600 font-semibold hover:text-teal-800 transition">View all →</button>
          </div>
          {!stats?.recentPayments.length ? (
            <div className="flex items-center justify-center py-8"><p className="text-sm text-gray-400">No payments recorded yet</p></div>
          ) : (
            <div className="divide-y divide-gray-50">
              {stats.recentPayments.map(p => (
                <div key={p.id} className="flex items-center gap-3 py-2.5">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm font-bold"
                    style={{background:'#e6fafa',color:'#0d9f9f'}}>
                    {p.tenant_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{p.tenant_name}</p>
                    <p className="text-xs text-gray-400">Unit {p.unit_number} · {p.property_name}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-emerald-600">{KES(p.amount)}</p>
                    <p className="text-xs text-gray-400">{CHAN[p.channel]??p.channel} · {ago(p.recorded_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent lease activity */}
      <div className={`${C} p-6`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-900">Recent Lease Activity</h2>
          <button onClick={() => navigate('/leases')} className="text-xs text-teal-600 font-semibold hover:text-teal-800 transition">View all →</button>
        </div>
        {!stats?.recentLeases.length ? (
          <p className="text-sm text-gray-400 py-4 text-center">No leases yet</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {stats.recentLeases.map(l => (
              <div key={l.id} className="p-3 rounded-xl border border-gray-100 hover:border-teal-200 transition">
                <div className="flex items-center justify-between mb-2">
                  <div className="w-2 h-2 rounded-full" style={{background:SCOL[l.status]??'#9ca3af'}} />
                  <span className="text-xs font-semibold capitalize" style={{color:SCOL[l.status]??'#9ca3af'}}>{l.status}</span>
                </div>
                <p className="text-sm font-semibold text-gray-900 truncate">{l.tenant_name}</p>
                <p className="text-xs text-gray-400 mt-0.5">Unit {l.unit_number} · {l.property_name}</p>
                <p className="text-xs font-bold text-gray-700 mt-2">{KES(l.monthly_rent)}/mo</p>
                <p className="text-xs text-gray-400">{ago(l.created_at)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}