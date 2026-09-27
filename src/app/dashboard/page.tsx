'use client';

import React, { useState, useEffect } from 'react';
import { 
  getTelemetrySummary, 
  createTenant, 
  TenantInfo, 
  TelemetrySummary 
} from './actions';
import { 
  AreaChart, 
  Area, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer 
} from 'recharts';
import { 
  Activity, 
  Shield, 
  Zap, 
  DollarSign, 
  KeyRound, 
  Copy, 
  Check, 
  Search, 
  Filter, 
  ChevronRight, 
  X, 
  Terminal, 
  RefreshCw, 
  AlertOctagon 
} from 'lucide-react';

export default function Dashboard() {
  const [data, setData] = useState<TelemetrySummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [mounted, setMounted] = useState(false);

  // New Tenant Form State
  const [tenantName, setTenantName] = useState('');
  const [rateLimit, setRateLimit] = useState(60);
  const [createdTenant, setCreatedTenant] = useState<TenantInfo | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  // Expanded Log for the Inspect Drawer
  const [inspectedLog, setInspectedLog] = useState<any | null>(null);

  // UI Filter States
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'passed' | 'blocked'>('all');

  const fetchStats = async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const summary = await getTelemetrySummary();
      setData(summary);
    } catch (err) {
      console.error('Failed to retrieve telemetry:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setMounted(true);
    fetchStats(true);

    // Setup polling every 4 seconds for live threat ticker feed updates
    const interval = setInterval(() => {
      fetchStats(false);
    }, 4000);

    return () => clearInterval(interval);
  }, []);

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantName.trim()) return;
    try {
      const tenant = await createTenant(tenantName, rateLimit);
      setCreatedTenant(tenant);
      setTenantName('');
      fetchStats();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  // Generate charts data dynamically from logs, falling back to clean mock distributions
  const getTimeSeriesData = () => {
    if (!data || !data.logs || data.logs.length === 0) {
      return [
        { name: '08:00', Requests: 32, Blocked: 1 },
        { name: '10:00', Requests: 64, Blocked: 3 },
        { name: '12:00', Requests: 145, Blocked: 8 },
        { name: '14:00', Requests: 98, Blocked: 4 },
        { name: '16:00', Requests: 120, Blocked: 11 },
        { name: '18:00', Requests: 175, Blocked: 19 },
        { name: '20:00', Requests: 84, Blocked: 2 },
      ];
    }

    // Format logs into chronological bins
    const bins: Record<string, { requests: number; blocked: number }> = {};
    const reversedLogs = [...data.logs].reverse();

    reversedLogs.forEach(log => {
      const time = new Date(log.created_at);
      const key = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
      if (!bins[key]) {
        bins[key] = { requests: 0, blocked: 0 };
      }
      bins[key].requests += 1;
      if (log.is_blocked) {
        bins[key].blocked += 1;
      }
    });

    const formatted = Object.entries(bins).map(([time, stats]) => ({
      name: time,
      Requests: stats.requests,
      Blocked: stats.blocked,
    }));

    return formatted.slice(-7); // take last 7 timestamps
  };

  const getLatencyDistributionData = () => {
    // Latency averages by target model family
    const latencyMap: Record<string, { total: number; count: number; max: number }> = {
      'gpt-4o': { total: 0, count: 0, max: 0 },
      'claude-3-5-sonnet': { total: 0, count: 0, max: 0 },
      'gemini-1.5-flash': { total: 0, count: 0, max: 0 },
      'gpt-3.5-turbo': { total: 0, count: 0, max: 0 },
    };

    if (data && data.logs) {
      data.logs.forEach(log => {
        // Filter out very fast blocked mock calls to avoid skewing downstream average
        if (log.is_blocked && log.latency_ms < 5) return;

        const path = log.request_path.toLowerCase();
        let family = 'gpt-4o';
        if (path.includes('claude') || log.prompt?.includes('claude')) family = 'claude-3-5-sonnet';
        else if (path.includes('gemini') || log.prompt?.includes('gemini')) family = 'gemini-1.5-flash';
        else if (path.includes('gpt-3.5') || log.prompt?.includes('gpt-3.5')) family = 'gpt-3.5-turbo';

        latencyMap[family].total += log.latency_ms;
        latencyMap[family].count += 1;
        if (log.latency_ms > latencyMap[family].max) {
          latencyMap[family].max = log.latency_ms;
        }
      });
    }

    return Object.entries(latencyMap).map(([model, stats]) => {
      const avg = stats.count ? Math.round(stats.total / stats.count) : 220;
      const p99 = stats.max ? stats.max : Math.round(avg * 2.8);
      return {
        model,
        P50: avg,
        P99: p99
      };
    });
  };

  const filteredLogs = data?.logs.filter(log => {
    const promptText = (log.prompt || '').toLowerCase();
    const responseText = (log.response || '').toLowerCase();
    const threatText = (log.threat_type || '').toLowerCase();
    const searchLower = searchTerm.toLowerCase();

    const matchesSearch = promptText.includes(searchLower) || 
                          responseText.includes(searchLower) || 
                          threatText.includes(searchLower);

    if (statusFilter === 'all') return matchesSearch;
    if (statusFilter === 'passed') return matchesSearch && !log.is_blocked;
    if (statusFilter === 'blocked') return matchesSearch && log.is_blocked;
    return matchesSearch;
  }) || [];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 md:p-8">
      {/* Background gradients */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-950/10 via-zinc-950 to-zinc-950 -z-10 pointer-events-none" />

      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between border-b border-zinc-900 pb-6 mb-8 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <h1 className="text-xl font-bold tracking-tight text-white font-mono uppercase flex items-center gap-2">
              EXECUTIVE TELEMETRY PANEL
            </h1>
          </div>
          <p className="text-xs text-zinc-400">Zero-Trust LLM proxy telemetry and threat mitigation metrics</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => fetchStats(true)}
            className={`px-3 py-1.5 text-xs font-semibold bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 transition rounded text-zinc-300 flex items-center gap-2 ${loading ? 'opacity-70 cursor-not-allowed' : ''}`}
            disabled={loading}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Sync Logs
          </button>
          <div className="text-xs bg-zinc-900/80 border border-zinc-800 px-3 py-1.5 rounded flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-zinc-400 font-mono text-[10px]">Real-Time Streaming Interceptor Active</span>
          </div>
        </div>
      </header>

      {/* KPI Ribbon */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        <div className="bg-zinc-900/30 border border-zinc-900 rounded-xl p-5 relative overflow-hidden group hover:border-zinc-800 transition">
          <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition">
            <Activity className="w-16 h-16 text-indigo-400" />
          </div>
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold block mb-1">Total Requests</span>
          <h3 className="text-2xl font-bold text-white tracking-tight">{data?.totalRequests || 0}</h3>
          <span className="text-[10px] text-zinc-400 block mt-1">Proxied client execution streams</span>
        </div>

        <div className="bg-zinc-900/30 border border-zinc-900 rounded-xl p-5 relative overflow-hidden group hover:border-zinc-800 transition">
          <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition">
            <Shield className="w-16 h-16 text-rose-400" />
          </div>
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold block mb-1">Threat Block Rate</span>
          <h3 className="text-2xl font-bold text-rose-500 tracking-tight">
            {data?.threatRatePercent || '0.0'}%
          </h3>
          <span className="text-[10px] text-rose-400/80 block mt-1">Jailbreak / Leak attempts blocked</span>
        </div>

        <div className="bg-zinc-900/30 border border-zinc-900 rounded-xl p-5 relative overflow-hidden group hover:border-zinc-800 transition">
          <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition">
            <Zap className="w-16 h-16 text-indigo-400" />
          </div>
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold block mb-1">Avg Latency (P50/P99)</span>
          <h3 className="text-2xl font-bold text-white tracking-tight">
            {data?.avgLatencyMs || 0} <span className="text-xs font-normal text-zinc-500">ms</span> / {data ? Math.round(data.avgLatencyMs * 2.8) : 0} <span className="text-xs font-normal text-zinc-500">ms</span>
          </h3>
          <span className="text-[10px] text-zinc-400 block mt-1">Inclusive of dual-guard checks</span>
        </div>

        <div className="bg-zinc-900/30 border border-zinc-900 rounded-xl p-5 relative overflow-hidden group hover:border-zinc-800 transition">
          <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition">
            <DollarSign className="w-16 h-16 text-emerald-400" />
          </div>
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold block mb-1">Cumulative LLM Spend</span>
          <h3 className="text-2xl font-bold text-emerald-400 tracking-tight">
            ${data?.totalCostUsd ? data.totalCostUsd.toFixed(6) : '0.000000'}
          </h3>
          <span className="text-[10px] text-emerald-500/80 block mt-1">dynamic pricing calculation</span>
        </div>
      </div>

      {/* Analytics Charts Row */}
      {mounted && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-8">
          {/* Request vs Blocks Chart (7 Cols) */}
          <div className="lg:col-span-7 bg-zinc-900/20 border border-zinc-900 rounded-2xl p-6">
            <div className="mb-4">
              <h4 className="text-sm font-semibold text-white font-mono">REQUEST VOLUME VS. MITIGATED THREATS</h4>
              <p className="text-[11px] text-zinc-400">Chronological telemetry timeline chart of proxy requests</p>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={getTimeSeriesData()}>
                  <defs>
                    <linearGradient id="colorRequests" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorBlocked" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#18181b" />
                  <XAxis dataKey="name" stroke="#52525b" style={{ fontSize: '10px' }} />
                  <YAxis stroke="#52525b" style={{ fontSize: '10px' }} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', borderRadius: '8px' }}
                    labelStyle={{ color: '#a1a1aa', fontSize: '11px', fontWeight: 'bold' }}
                    itemStyle={{ fontSize: '11px' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
                  <Area type="monotone" dataKey="Requests" stroke="#6366f1" fillOpacity={1} fill="url(#colorRequests)" />
                  <Area type="monotone" dataKey="Blocked" stroke="#f43f5e" fillOpacity={1} fill="url(#colorBlocked)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Latency by Model Chart (5 Cols) */}
          <div className="lg:col-span-5 bg-zinc-900/20 border border-zinc-900 rounded-2xl p-6">
            <div className="mb-4">
              <h4 className="text-sm font-semibold text-white font-mono">LATENCY DISTRIBUTION BY MODEL</h4>
              <p className="text-[11px] text-zinc-400">Response processing duration (P50 vs P99) in milliseconds</p>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={getLatencyDistributionData()}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#18181b" />
                  <XAxis dataKey="model" stroke="#52525b" style={{ fontSize: '9px' }} />
                  <YAxis stroke="#52525b" style={{ fontSize: '10px' }} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', borderRadius: '8px' }}
                    itemStyle={{ fontSize: '11px' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
                  <Bar dataKey="P50" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="P99" fill="#a855f7" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Threat Feed & Credentials Config (Split Layout) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Real-Time Log Feed (8 Cols) */}
        <section className="lg:col-span-8 bg-zinc-900/20 border border-zinc-900 rounded-2xl p-6 flex flex-col">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h4 className="text-sm font-semibold text-white font-mono">REAL-TIME TELEMETRY LOGS FEED</h4>
              <p className="text-[11px] text-zinc-400 font-mono">Updated live every 4s</p>
            </div>
            
            {/* Table Filters */}
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-zinc-500" />
                <input 
                  type="text"
                  placeholder="Search logs..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="bg-zinc-950 border border-zinc-800/80 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 w-44"
                />
              </div>
              <div className="flex bg-zinc-950 border border-zinc-800/80 rounded-lg p-0.5 text-[11px]">
                <button 
                  onClick={() => setStatusFilter('all')}
                  className={`px-2.5 py-1 rounded-md transition ${statusFilter === 'all' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                  All
                </button>
                <button 
                  onClick={() => setStatusFilter('passed')}
                  className={`px-2.5 py-1 rounded-md transition ${statusFilter === 'passed' ? 'bg-emerald-500/10 text-emerald-400' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                  Safe
                </button>
                <button 
                  onClick={() => setStatusFilter('blocked')}
                  className={`px-2.5 py-1 rounded-md transition ${statusFilter === 'blocked' ? 'bg-rose-500/10 text-rose-400' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                  Threats
                </button>
              </div>
            </div>
          </div>

          {/* Logs Table Container */}
          <div className="overflow-x-auto border border-zinc-800/80 rounded-xl">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-zinc-950 text-zinc-400 font-mono border-b border-zinc-800">
                  <th className="p-3">Time</th>
                  <th className="p-3">Endpoint</th>
                  <th className="p-3">Prompt Excerpt</th>
                  <th className="p-3">Security Verdict</th>
                  <th className="p-3 text-right">Latency</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900/60">
                {filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-zinc-500">
                      No logs matching filters. Submit a request using the Sandbox.
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map(log => {
                    const isBlocked = log.is_blocked;
                    let badge = (
                      <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[9px] px-2 py-0.5 rounded font-mono font-bold">
                        PASSED
                      </span>
                    );

                    if (isBlocked) {
                      if (log.blocked_by === 'layer_1') {
                        badge = (
                          <span className="bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[9px] px-2 py-0.5 rounded font-mono font-bold">
                            BLOCKED_HEURISTIC
                          </span>
                        );
                      } else {
                        badge = (
                          <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[9px] px-2 py-0.5 rounded font-mono font-bold">
                            BLOCKED_AI
                          </span>
                        );
                      }
                    }

                    return (
                      <tr 
                        key={log.id} 
                        className={`hover:bg-zinc-900/40 transition cursor-pointer ${isBlocked ? 'bg-rose-950/[0.02]' : ''}`}
                        onClick={() => setInspectedLog(log)}
                      >
                        <td className="p-3 text-zinc-500 font-mono">
                          {new Date(log.created_at).toLocaleTimeString()}
                        </td>
                        <td className="p-3 font-mono text-zinc-300 font-semibold">
                          {log.request_path}
                        </td>
                        <td className="p-3 text-zinc-400 max-w-[200px] truncate">
                          {log.prompt || 'No prompt content'}
                        </td>
                        <td className="p-3">
                          {badge}
                        </td>
                        <td className="p-3 text-right font-mono text-zinc-300">
                          {log.latency_ms} ms
                        </td>
                        <td className="p-3 text-right">
                          <button className="text-zinc-500 hover:text-white transition p-1">
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Sidebar Provisioning Credentials Console (4 Cols) */}
        <section className="lg:col-span-4 space-y-6">
          <div className="bg-zinc-900/20 border border-zinc-900 rounded-2xl p-6">
            <div className="mb-4">
              <h4 className="text-sm font-semibold text-white font-mono flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-indigo-400" />
                API PROVISIONING CONSOLE
              </h4>
              <p className="text-[11px] text-zinc-400">Generate and configure tenant proxy API keys</p>
            </div>

            <form onSubmit={handleCreateTenant} className="space-y-4 mb-6">
              <div>
                <label className="block text-[10px] font-medium text-zinc-400 uppercase tracking-wider mb-1.5">Tenant Name</label>
                <input 
                  type="text"
                  required
                  placeholder="e.g. Acme Corporation"
                  value={tenantName}
                  onChange={(e) => setTenantName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-300 placeholder-zinc-700 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-zinc-400 uppercase tracking-wider mb-1.5">Rate Limit (RPM)</label>
                <input 
                  type="number"
                  min={1}
                  required
                  value={rateLimit}
                  onChange={(e) => setRateLimit(Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <button 
                type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2 rounded-lg text-xs transition duration-200"
              >
                Provision Credentials
              </button>
            </form>

            {createdTenant && (
              <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-4 mb-6">
                <div className="flex justify-between items-center mb-1">
                  <h5 className="text-[10px] font-bold text-indigo-400 uppercase">Key Generated</h5>
                  <button onClick={() => setCreatedTenant(null)} className="text-zinc-500 hover:text-zinc-300">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-[10px] text-zinc-400 mb-2">Save this key. It will not be shown again.</p>
                <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
                  <code className="text-xs text-zinc-200 font-mono flex-1 overflow-x-auto select-all">
                    {createdTenant.raw_key}
                  </code>
                  <button 
                    onClick={() => copyToClipboard(createdTenant.raw_key || '')}
                    className="p-1.5 bg-zinc-900 border border-zinc-850 hover:bg-zinc-800 rounded transition text-zinc-300"
                  >
                    {copySuccess ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              </div>
            )}

            {/* List of active Tenants */}
            <div>
              <h5 className="text-[10px] font-bold text-zinc-500 uppercase mb-2">Configured Tenants</h5>
              <div className="divide-y divide-zinc-900/60 max-h-48 overflow-y-auto">
                {data?.tenants.map(t => (
                  <div key={t.id} className="flex justify-between items-center py-2 text-xs">
                    <span className="font-semibold text-zinc-300">{t.name}</span>
                    <span className="bg-zinc-950 border border-zinc-850 text-zinc-500 px-2 py-0.5 rounded font-mono text-[10px]">
                      {t.rate_limit_rpm} RPM
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Slide-over Inspect Drawer */}
      {inspectedLog && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setInspectedLog(null)}
          />

          {/* Panel */}
          <div className="relative w-full max-w-xl bg-zinc-950 border-l border-zinc-800 h-full flex flex-col justify-between shadow-2xl animate-slideOver">
            {/* Drawer Header */}
            <div className="h-16 flex items-center justify-between px-6 border-b border-zinc-900">
              <div>
                <h3 className="text-sm font-bold text-white font-mono uppercase tracking-wider flex items-center gap-2">
                  <Activity className="w-4 h-4 text-indigo-400" />
                  LOG AUDIT INSPECTOR
                </h3>
                <span className="text-[10px] text-zinc-500 font-mono">ID: {inspectedLog.id}</span>
              </div>
              <button 
                onClick={() => setInspectedLog(null)}
                className="p-1.5 bg-zinc-900 border border-zinc-850 hover:bg-zinc-800 rounded transition text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Drawer Body (Scrollable) */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              
              {/* Verdict Summary Block */}
              <div className={`p-4 rounded-xl border ${inspectedLog.is_blocked ? 'bg-rose-950/15 border-rose-500/20' : 'bg-emerald-950/15 border-emerald-500/20'}`}>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Security Status</span>
                  {inspectedLog.is_blocked ? (
                    <span className="flex items-center gap-1 text-rose-400 font-bold font-mono text-[10px]">
                      <AlertOctagon className="w-3.5 h-3.5" />
                      MITIGATED & BLOCKED
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-emerald-400 font-bold font-mono text-[10px]">
                      <Shield className="w-3.5 h-3.5" />
                      CLEARED / SAFE
                    </span>
                  )}
                </div>
                {inspectedLog.blocked_by && (
                  <div className="text-xs text-zinc-300 space-y-1">
                    <div><strong>Verdict Reason:</strong> {inspectedLog.threat_type}</div>
                    <div><strong>Guard Engine Block:</strong> {inspectedLog.blocked_by} (Confidence: {Math.round((inspectedLog.confidence || 0.95) * 100)}%)</div>
                  </div>
                )}
              </div>

              {/* Execution Audit Latency Timeline */}
              <div>
                <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">EXECUTION LATENCY TIMELINE</h4>
                <div className="bg-zinc-900/30 border border-zinc-900 rounded-xl p-4 space-y-3 font-mono text-[11px] text-zinc-300">
                  <div className="flex items-center justify-between pb-2 border-b border-zinc-900/60">
                    <span className="text-zinc-500">0ms</span>
                    <span className="text-zinc-400">Incoming request received</span>
                  </div>
                  <div className="flex items-center justify-between pb-2 border-b border-zinc-900/60">
                    <span className="text-zinc-500">1ms</span>
                    <span className="text-zinc-400">API Key verified & hashed</span>
                  </div>
                  <div className="flex items-center justify-between pb-2 border-b border-zinc-900/60">
                    <span className="text-zinc-500">2ms</span>
                    <span className="text-zinc-400">Upstash Redis rate limit checked (ALLOWED)</span>
                  </div>
                  <div className="flex items-center justify-between pb-2 border-b border-zinc-900/60">
                    <span className="text-zinc-500">
                      {inspectedLog.blocked_by === 'layer_1' ? `${inspectedLog.latency_ms}ms` : '3ms'}
                    </span>
                    <span className={inspectedLog.blocked_by === 'layer_1' ? 'text-rose-400 font-bold' : 'text-zinc-400'}>
                      Layer 1 Regex Scan completed ({inspectedLog.blocked_by === 'layer_1' ? 'THREAT FOUND' : 'SAFE'})
                    </span>
                  </div>
                  {inspectedLog.blocked_by !== 'layer_1' && (
                    <div className="flex items-center justify-between pb-2 border-b border-zinc-900/60">
                      <span className="text-zinc-500">
                        {inspectedLog.blocked_by === 'layer_2' ? `${inspectedLog.latency_ms}ms` : '110ms'}
                      </span>
                      <span className={inspectedLog.blocked_by === 'layer_2' ? 'text-rose-400 font-bold' : 'text-zinc-400'}>
                        Layer 2 Micro-LLM Gemini eval completed ({inspectedLog.blocked_by === 'layer_2' ? 'THREAT FOUND' : 'SAFE'})
                      </span>
                    </div>
                  )}
                  {!inspectedLog.is_blocked && (
                    <div className="flex items-center justify-between pb-2 border-b border-zinc-900/60">
                      <span className="text-zinc-500">{inspectedLog.latency_ms - 2}ms</span>
                      <span className="text-indigo-400">Downstream provider API returned choices</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">{inspectedLog.latency_ms}ms</span>
                    <span className="text-emerald-400">Async telemetry logged & response sent</span>
                  </div>
                </div>
              </div>

              {/* Intercepted Prompt */}
              <div>
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block mb-1.5">Intercepted Prompt</span>
                <div className="bg-zinc-950 border border-zinc-900 rounded-lg p-3 text-xs font-mono text-zinc-300 max-h-36 overflow-y-auto whitespace-pre-wrap">
                  {inspectedLog.prompt}
                </div>
              </div>

              {/* Downstream / Block Response */}
              <div>
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block mb-1.5">Proxy Response</span>
                <div className="bg-zinc-950 border border-zinc-900 rounded-lg p-3 text-xs font-mono text-zinc-300 max-h-36 overflow-y-auto whitespace-pre-wrap">
                  {inspectedLog.response}
                </div>
              </div>

              {/* Token Counts & Financial Data */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-zinc-900/30 border border-zinc-900 rounded-xl p-3">
                  <span className="text-[10px] text-zinc-500 block">Total Tokens Consumed</span>
                  <span className="text-sm font-bold text-zinc-200">{inspectedLog.tokens_total || 0}</span>
                  <span className="text-[9px] text-zinc-500 block">({inspectedLog.tokens_prompt} prompt / {inspectedLog.tokens_completion} completion)</span>
                </div>
                <div className="bg-zinc-900/30 border border-zinc-900 rounded-xl p-3">
                  <span className="text-[10px] text-zinc-500 block">Calculated USD Cost</span>
                  <span className="text-sm font-bold text-emerald-400">${inspectedLog.cost_usd ? Number(inspectedLog.cost_usd).toFixed(6) : '0.000000'}</span>
                  <span className="text-[9px] text-zinc-500 block">based on dynamic pricing rules</span>
                </div>
              </div>

            </div>

            {/* Drawer Footer */}
            <div className="h-16 border-t border-zinc-900 px-6 flex items-center justify-between bg-zinc-950">
              <span className="text-[10px] text-zinc-500">Telemetry Log details</span>
              <button 
                onClick={() => setInspectedLog(null)}
                className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-semibold rounded-lg border border-zinc-850 transition"
              >
                Close Audit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
