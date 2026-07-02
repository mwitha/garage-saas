import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import type { TooltipContentProps } from 'recharts';
import { AppLayout } from '../components/AppLayout';
import { useAuthStore } from '../store/authStore';
import api from '../lib/api';
import type { DashboardData, WorkOrderStatus, WorkOrderSummary } from '../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<WorkOrderStatus, { label: string; dot: string; badge: string }> = {
  received:      { label: 'Received',       dot: 'bg-gray-400',   badge: 'bg-gray-100 text-gray-600' },
  diagnosing:    { label: 'Diagnosing',     dot: 'bg-amber-400',  badge: 'bg-amber-100 text-amber-700' },
  waiting_parts: { label: 'Waiting Parts',  dot: 'bg-orange-400', badge: 'bg-orange-100 text-orange-700' },
  in_progress:   { label: 'In Progress',    dot: 'bg-blue-500',   badge: 'bg-blue-100 text-blue-700' },
  quality_check: { label: 'Quality Check',  dot: 'bg-indigo-500', badge: 'bg-indigo-100 text-indigo-700' },
  ready:         { label: 'Ready',          dot: 'bg-green-500',  badge: 'bg-green-100 text-green-700' },
  delivered:     { label: 'Delivered',      dot: 'bg-purple-400', badge: 'bg-purple-100 text-purple-700' },
  cancelled:     { label: 'Cancelled',      dot: 'bg-red-400',    badge: 'bg-red-100 text-red-600' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number): string {
  if (n >= 1_000_000) return `LKR ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `LKR ${(n / 1_000).toFixed(0)}K`;
  return `LKR ${Math.round(n).toLocaleString('en-US')}`;
}

function fmtFull(n: number): string {
  return `LKR ${Math.round(n).toLocaleString('en-US')}`;
}

function trend(current: number, previous: number): { pct: number; up: boolean; neutral: boolean } {
  if (previous === 0) return { pct: 0, up: true, neutral: true };
  const pct = ((current - previous) / previous) * 100;
  return { pct: Math.abs(pct), up: pct >= 0, neutral: false };
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function todayLabel(): string {
  return new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------

interface KpiProps {
  label: string;
  value: string | number;
  sub?: string;
  current?: number;
  previous?: number;
  accent: string;      // tailwind bg colour for icon ring
  iconColour: string;  // tailwind text colour
  icon: React.ReactNode;
}

function KpiCard({ label, value, sub, current, previous, accent, iconColour, icon }: KpiProps) {
  const t = (current !== undefined && previous !== undefined) ? trend(current, previous) : null;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 flex flex-col gap-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${accent}`}>
          <span className={iconColour}>{icon}</span>
        </div>
      </div>

      <div>
        <p className="text-2xl font-bold text-gray-900 leading-none tracking-tight">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
      </div>

      {t && (
        <div className={`flex items-center gap-1 text-xs font-semibold ${
          t.neutral ? 'text-gray-400' : t.up ? 'text-emerald-600' : 'text-red-500'
        }`}>
          {!t.neutral && (
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d={t.up ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
            </svg>
          )}
          <span>{t.neutral ? 'No data last month' : `${t.pct.toFixed(0)}% vs last month`}</span>
        </div>
      )}
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 flex flex-col gap-4 shadow-sm animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-2.5 bg-gray-100 rounded w-24" />
        <div className="w-9 h-9 rounded-xl bg-gray-100" />
      </div>
      <div className="h-7 bg-gray-100 rounded w-28" />
      <div className="h-3 bg-gray-100 rounded w-32" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Revenue chart tooltip
// ---------------------------------------------------------------------------

function ChartTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-lg text-sm min-w-[160px]">
      <p className="font-semibold text-gray-700 mb-2">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            <span className="text-gray-500 capitalize">{p.name}</span>
          </div>
          <span className="font-semibold text-gray-900">{fmt(p.value as number)}</span>
        </div>
      ))}
      {payload.length === 2 && (
        <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between">
          <span className="text-gray-500">Profit</span>
          <span className={`font-bold ${((payload[0].value as number) - (payload[1].value as number)) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {fmt((payload[0].value as number) - (payload[1].value as number))}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Work order pipeline
// ---------------------------------------------------------------------------

function Pipeline({ data, loading }: { data: DashboardData['pipeline']; loading: boolean }) {
  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col gap-4 h-full">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Job Pipeline</h2>
        <p className="text-xs text-gray-400 mt-0.5">Active work orders by stage</p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-1">
              <div className="h-3 bg-gray-100 rounded animate-pulse w-24" />
              <div className="h-2 bg-gray-100 rounded-full animate-pulse" />
            </div>
          ))}
        </div>
      ) : total === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
          No active jobs
        </div>
      ) : (
        <div className="space-y-3">
          {(Object.keys(STATUS_CONFIG) as WorkOrderStatus[])
            .filter((s) => s !== 'delivered' && s !== 'cancelled')
            .map((status) => {
              const row = data.find((d) => d.status === status);
              const count = row?.count ?? 0;
              const pct = total > 0 ? (count / total) * 100 : 0;
              const cfg = STATUS_CONFIG[status];
              return (
                <div key={status}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                      <span className="text-xs font-medium text-gray-600">{cfg.label}</span>
                    </div>
                    <span className="text-xs font-bold text-gray-900">{count}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${cfg.dot}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })
          }
          <p className="text-xs text-gray-400 pt-1 border-t border-gray-100">
            {total} job{total !== 1 ? 's' : ''} in progress
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: WorkOrderStatus }) {
  const cfg = STATUS_CONFIG[status] ?? { badge: 'bg-gray-100 text-gray-600', label: status };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${cfg.badge}`}>
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Active work orders table
// ---------------------------------------------------------------------------

function ActiveJobs({ data, loading }: { data: WorkOrderSummary[]; loading: boolean }) {
  const navigate = useNavigate();

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Active Work Orders</h2>
          <p className="text-xs text-gray-400 mt-0.5">All open jobs, newest first</p>
        </div>
        <button
          onClick={() => navigate('/work-orders')}
          className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
        >
          View all →
        </button>
      </div>

      <div className="overflow-auto flex-1">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-gray-50 border-b border-gray-100">
            <tr>
              {['Order', 'Vehicle', 'Customer', 'Status', 'Age'].map((h) => (
                <th key={h} className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading && Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>
                {[20, 36, 32, 24, 12].map((w, j) => (
                  <td key={j} className="px-5 py-3.5">
                    <div className={`h-3.5 bg-gray-100 rounded animate-pulse w-${w}`} />
                  </td>
                ))}
              </tr>
            ))}

            {!loading && data.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-14 text-center">
                  <div className="flex flex-col items-center gap-2 text-gray-400">
                    <svg className="w-8 h-8 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    <p className="text-sm">No active work orders</p>
                  </div>
                </td>
              </tr>
            )}

            {!loading && data.map((wo) => (
              <tr
                key={wo.id}
                onClick={() => navigate(`/work-orders/${wo.id}`)}
                className="hover:bg-blue-50/40 cursor-pointer transition-colors group"
              >
                <td className="px-5 py-3.5">
                  <span className="text-xs font-mono font-semibold text-blue-600 group-hover:text-blue-700">
                    {wo.order_number}
                  </span>
                </td>
                <td className="px-5 py-3.5">
                  <p className="text-sm font-medium text-gray-900">{wo.plate_number}</p>
                  <p className="text-xs text-gray-400">{wo.make} {wo.model}</p>
                </td>
                <td className="px-5 py-3.5 text-sm text-gray-700">{wo.customer_name}</td>
                <td className="px-5 py-3.5">
                  <StatusBadge status={wo.status} />
                </td>
                <td className="px-5 py-3.5 text-xs text-gray-400 whitespace-nowrap">
                  {relativeTime(wo.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Today's jobs
// ---------------------------------------------------------------------------

function TodaysJobs({ data, loading }: { data: WorkOrderSummary[]; loading: boolean }) {
  const navigate = useNavigate();

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">Today&apos;s Jobs</h2>
        <p className="text-xs text-gray-400 mt-0.5">Received today</p>
      </div>

      <div className="flex-1 overflow-auto divide-y divide-gray-50 px-1">
        {loading && Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="px-4 py-3.5 space-y-2">
            <div className="flex justify-between">
              <div className="h-3 bg-gray-100 rounded animate-pulse w-20" />
              <div className="h-4 bg-gray-100 rounded-full animate-pulse w-16" />
            </div>
            <div className="h-3.5 bg-gray-100 rounded animate-pulse w-3/4" />
          </div>
        ))}

        {!loading && data.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-gray-400 gap-2">
            <svg className="w-7 h-7 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-sm">No new jobs today</p>
          </div>
        )}

        {!loading && data.map((job) => (
          <div
            key={job.id}
            onClick={() => navigate(`/work-orders/${job.id}`)}
            className="px-4 py-3.5 hover:bg-blue-50/40 cursor-pointer transition-colors"
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <span className="text-xs font-mono font-semibold text-blue-600">{job.order_number}</span>
              <StatusBadge status={job.status} />
            </div>
            <p className="text-sm text-gray-900 font-medium">{job.plate_number}
              <span className="font-normal text-gray-400 ml-1 text-xs">{job.make} {job.model}</span>
            </p>
            {job.customer_complaint ? (
              <p className="text-xs text-gray-500 line-clamp-1 mt-0.5">{job.customer_complaint}</p>
            ) : (
              <p className="text-xs text-gray-300 italic mt-0.5">No complaint noted</p>
            )}
            <p className="text-xs text-gray-400 mt-1">
              {job.assigned_to_name ?? 'Unassigned'} · {relativeTime(job.created_at)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Low stock list
// ---------------------------------------------------------------------------

function LowStockList({ data, loading }: { data: DashboardData['low_stock_list']; loading: boolean }) {
  const navigate = useNavigate();

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Low Stock Alerts</h2>
          <p className="text-xs text-gray-400 mt-0.5">Items below reorder threshold</p>
        </div>
        {data.length > 0 && (
          <button
            onClick={() => navigate('/inventory')}
            className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
          >
            View inventory →
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto divide-y divide-gray-50">
        {loading && Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="px-5 py-3 space-y-1.5">
            <div className="h-3.5 bg-gray-100 rounded animate-pulse w-40" />
            <div className="h-2 bg-gray-100 rounded-full animate-pulse" />
          </div>
        ))}

        {!loading && data.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-gray-400 gap-2">
            <svg className="w-7 h-7 text-green-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <p className="text-sm text-green-600 font-medium">All stock levels OK</p>
          </div>
        )}

        {!loading && data.map((item) => {
          const pct = Math.min(100, (item.quantity / item.reorder_threshold) * 100);
          const critical = item.quantity === 0;
          return (
            <div key={item.id} className="px-5 py-3">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-sm font-medium text-gray-900 truncate pr-2">{item.name}</p>
                <span className={`text-xs font-bold flex-shrink-0 ${critical ? 'text-red-600' : 'text-orange-500'}`}>
                  {critical ? 'OUT' : `${item.quantity}`}
                  {!critical && <span className="font-normal text-gray-400"> / {item.reorder_threshold}</span>}
                </span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${critical ? 'bg-red-500' : 'bg-orange-400'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function DashboardPage() {
  const user = useAuthStore((s) => s.user);

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/api/dashboard').then((r) => r.data.data),
    refetchInterval: 60_000,
  });

  const s = data?.stats;

  const profitThisMonth  = (s?.revenue_this_month ?? 0)  - (s?.expenses_this_month ?? 0);
  const profitLastMonth  = (s?.revenue_last_month ?? 0)  - (s?.expenses_last_month ?? 0);

  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-7xl mx-auto space-y-6">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <p className="text-xs text-gray-400 font-medium">{todayLabel()}</p>
            <h1 className="text-xl font-bold text-gray-900 mt-0.5">
              {greeting()}, {user?.name?.split(' ')[0]} 👋
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {s && (
              <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <span className="text-xs font-semibold text-amber-700">
                  {s.jobs_today} job{s.jobs_today !== 1 ? 's' : ''} received today
                </span>
                <span className="text-amber-300 mx-1">·</span>
                <span className="text-xs font-semibold text-amber-700">
                  {fmtFull(s.revenue_today)} collected
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ── KPI Row ─────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <KpiSkeleton key={i} />)
          ) : (
            <>
              <KpiCard
                label="Revenue This Month"
                value={fmt(s?.revenue_this_month ?? 0)}
                sub={`${s?.completed_this_month ?? 0} jobs completed`}
                current={s?.revenue_this_month}
                previous={s?.revenue_last_month}
                accent="bg-blue-50"
                iconColour="text-blue-600"
                icon={
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
              />

              <KpiCard
                label="Profit This Month"
                value={fmt(profitThisMonth)}
                sub={`Revenue – Expenses`}
                current={profitThisMonth}
                previous={profitLastMonth}
                accent={profitThisMonth >= 0 ? 'bg-emerald-50' : 'bg-red-50'}
                iconColour={profitThisMonth >= 0 ? 'text-emerald-600' : 'text-red-500'}
                icon={
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                }
              />

              <KpiCard
                label="Active Work Orders"
                value={s?.active_work_orders ?? 0}
                sub={`${s?.vehicles_in_workshop ?? 0} vehicles in workshop`}
                accent="bg-indigo-50"
                iconColour="text-indigo-600"
                icon={
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                }
              />

              <KpiCard
                label="Unpaid Invoices"
                value={fmt(s?.unpaid_invoices_total ?? 0)}
                sub={`${s?.unpaid_invoices_count ?? 0} invoice${(s?.unpaid_invoices_count ?? 0) !== 1 ? 's' : ''} outstanding`}
                accent="bg-amber-50"
                iconColour="text-amber-600"
                icon={
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
                  </svg>
                }
              />
            </>
          )}
        </div>

        {/* ── Revenue Chart + Pipeline ─────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Chart */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Revenue vs Expenses</h2>
                <p className="text-xs text-gray-400 mt-0.5">Last 6 months</p>
              </div>
              {s && (
                <div className="text-right">
                  <p className="text-xs text-gray-400">This month profit</p>
                  <p className={`text-sm font-bold ${profitThisMonth >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {fmtFull(profitThisMonth)}
                  </p>
                </div>
              )}
            </div>
            {isLoading ? (
              <div className="h-52 bg-gray-50 rounded-xl animate-pulse" />
            ) : (
              <ResponsiveContainer width="100%" height={210}>
                <BarChart
                  data={data?.revenue_chart ?? []}
                  margin={{ top: 4, right: 4, left: 4, bottom: 0 }}
                  barCategoryGap="30%"
                  barGap={3}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={fmt} tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={72} />
                  <Tooltip content={ChartTooltip} cursor={{ fill: '#f8fafc' }} />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: '11px', paddingTop: '12px' }}
                    formatter={(v) => <span style={{ color: '#6b7280', textTransform: 'capitalize' }}>{v}</span>}
                  />
                  <Bar dataKey="revenue"  name="Revenue"  fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={36} />
                  <Bar dataKey="expenses" name="Expenses" fill="#f87171" radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Pipeline */}
          <Pipeline data={data?.pipeline ?? []} loading={isLoading} />
        </div>

        {/* ── Bottom Row ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Active jobs table — 2/3 */}
          <div className="lg:col-span-2" style={{ minHeight: 360 }}>
            <ActiveJobs data={data?.active_work_orders ?? []} loading={isLoading} />
          </div>

          {/* Right column: Today's jobs + Low stock stacked */}
          <div className="flex flex-col gap-6">
            <div className="flex-1" style={{ minHeight: 200 }}>
              <TodaysJobs data={data?.todays_jobs ?? []} loading={isLoading} />
            </div>
            <div style={{ minHeight: 180 }}>
              <LowStockList data={data?.low_stock_list ?? []} loading={isLoading} />
            </div>
          </div>
        </div>

      </div>
    </AppLayout>
  );
}
