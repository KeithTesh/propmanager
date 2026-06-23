// web/src/pages/reports/ReportsPage.tsx

import { useToast } from '../../components/ui/Toast';
import { useState } from 'react';
import { apiClient, tokenStore } from '../../lib/api';
interface Property { id: string; name: string; }
import { useQuery } from '@tanstack/react-query';

const REPORTS = [
  {
    id: 'income-statement',
    title: 'Income Statement',
    desc: 'Revenue vs expenses with monthly trend',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
    color: '#10b981',
    bg: '#d1fae5',
    params: ['dateRange'],
  },
  {
    id: 'rent-roll',
    title: 'Rent Roll',
    desc: 'All units, tenants, lease status & rent amounts',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 21v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21m0 0h4.5V3.545M12.75 21h7.5V10.75M2.25 21h1.5m18 0h-18M2.25 9l4.5-1.636M18.75 3l-1.5.545m0 6.205l3 1m1.5.5l-1.5-.5M6.75 7.364V3h-3v18m3-13.636l10.5-3.819" />
      </svg>
    ),
    color: '#3b82f6',
    bg: '#dbeafe',
    params: ['property'],
  },
  {
    id: 'occupancy',
    title: 'Occupancy Report',
    desc: 'Vacant vs occupied by property with rates',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
      </svg>
    ),
    color: '#8b5cf6',
    bg: '#ede9fe',
    params: [],
  },
  {
    id: 'collection',
    title: 'Collection Report',
    desc: 'Payments collected vs outstanding by property',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75" />
      </svg>
    ),
    color: '#f59e0b',
    bg: '#fef3c7',
    params: ['month'],
  },
];

export default function ReportsPage() {
  const { toast } = useToast();
  const [downloading, setDownloading] = useState<string | null>(null);
  const [fromDate,    setFromDate]    = useState(new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10));
  const [toDate,      setToDate]      = useState(new Date().toISOString().slice(0, 10));
  const [month,       setMonth]       = useState(new Date().toISOString().slice(0, 7));
  const [propertyId,  setPropertyId]  = useState('');

  const { data: properties } = useQuery<Property[]>({
    queryKey: ['properties-list'],
    queryFn: async () => {
      const r = await apiClient.get<{ data: { properties: Property[] } }>('/properties');
      return r.data.data.properties;
    },
  });

  async function download(reportId: string, format: 'pdf' | 'xlsx') {
    const key = `${reportId}-${format}`;
    setDownloading(key);
    try {
      const params = new URLSearchParams({ format });
      if (reportId === 'income-statement') {
        params.set('from', fromDate);
        params.set('to',   toDate);
      }
      if (reportId === 'collection') params.set('month', month + '-01');
      if (reportId === 'rent-roll' && propertyId) params.set('property_id', propertyId);

      const response = await fetch(`/api/v1/reports/${reportId}?${params}`, {
        headers: {
          Authorization: `Bearer ${tokenStore.get() ?? ''}`,
        },
      });

      if (!response.ok) throw new Error(`Failed: ${response.status}`);

      const blob = await response.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      const ext  = format === 'pdf' ? 'pdf' : 'xlsx';
      a.href     = url;
      a.download = `${reportId}-${new Date().toISOString().slice(0,10)}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast('Failed to generate report. Please try again.', 'error');
      console.error(e);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="p-6 lg:p-8 ">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
        <p className="text-sm text-gray-500 mt-0.5">Generate and download financial reports as PDF or Excel</p>
      </div>

      {/* Global date filters */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6">
        <h2 className="text-sm font-bold text-gray-700 mb-3">Report Parameters</h2>
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">From Date</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">To Date</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Month (Collection)</label>
            <input type="month" value={month} onChange={e => setMonth(e.target.value)}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Property (Rent Roll)</label>
            <select value={propertyId} onChange={e => setPropertyId(e.target.value)}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white">
              <option value="">All properties</option>
              {(properties ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Report cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {REPORTS.map(report => (
          <div key={report.id}
            className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: report.bg, color: report.color }}>
                {report.icon}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-gray-900">{report.title}</h3>
                <p className="text-sm text-gray-500 mt-0.5">{report.desc}</p>
                {report.id === 'income-statement' && (
                  <p className="text-xs text-gray-400 mt-1">{fromDate} → {toDate}</p>
                )}
                {report.id === 'collection' && (
                  <p className="text-xs text-gray-400 mt-1">{new Date(month + '-01').toLocaleDateString('en-KE', { month: 'long', year: 'numeric' })}</p>
                )}
                {report.id === 'rent-roll' && propertyId && (
                  <p className="text-xs text-gray-400 mt-1">{(properties ?? []).find(p => p.id === propertyId)?.name}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1 border-t border-gray-50">
              <button
                onClick={() => download(report.id, 'pdf')}
                disabled={!!downloading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 bg-gray-50 hover:bg-gray-100 transition disabled:opacity-50">
                {downloading === `${report.id}-pdf`
                  ? <span className="flex items-center gap-2"><div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{borderColor:'#6b7280',borderTopColor:'transparent'}} /> Generating…</span>
                  : <>
                    <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M14.5 2.5c0-1.1-.9-2-2-2H3C1.9.5 1 1.4 1 2.5v19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V9.5c0-.5-.2-1-.6-1.4l-5-5c-.4-.4-.9-.6-1.4-.6zm-2 1.5l5 5h-5V4zM3 21.5V2.5h7.5v7c0 .6.4 1 1 1H19v11H3z"/>
                    </svg>
                    <span>PDF</span>
                  </>
                }
              </button>
              <button
                onClick={() => download(report.id, 'xlsx')}
                disabled={!!downloading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 bg-gray-50 hover:bg-gray-100 transition disabled:opacity-50">
                {downloading === `${report.id}-xlsx`
                  ? <span className="flex items-center gap-2"><div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{borderColor:'#6b7280',borderTopColor:'transparent'}} /> Generating…</span>
                  : <>
                    <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M14.5 2.5c0-1.1-.9-2-2-2H3C1.9.5 1 1.4 1 2.5v19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V9.5c0-.5-.2-1-.6-1.4l-5-5c-.4-.4-.9-.6-1.4-.6zm-2 1.5l5 5h-5V4zM3 21.5V2.5h7.5v7c0 .6.4 1 1 1H19v11H3z"/>
                    </svg>
                    <span>Excel</span>
                  </>
                }
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-400 mt-6 text-center">
        Reports are generated on demand from live data · Large date ranges may take a few seconds
      </p>
    </div>
  );
}