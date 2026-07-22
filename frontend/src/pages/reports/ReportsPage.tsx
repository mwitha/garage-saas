import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  BarChart, Bar,
  XAxis, YAxis,
  CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import type { TooltipContentProps, PieLabelRenderProps } from 'recharts';
import { AppLayout } from '../../components/AppLayout';
import { CompanyHeader } from '../../components/CompanyHeader';
import { PayDialog } from '../../components/PayDialog';
import api from '../../lib/api';
import type { ReportsData, AgingReportData, AgingCustomerRow, AgingInvoiceRow, PaymentMethod } from '../../types';

// ---------------------------------------------------------------------------
// Defaults & helpers
// ---------------------------------------------------------------------------

function defaultFrom() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() - 11, 1).toISOString().slice(0, 10);
}
function defaultTo() {
  return new Date().toISOString().slice(0, 10);
}

function formatLKR(n: number) {
  if (n >= 1_000_000) return `LKR ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `LKR ${(n / 1_000).toFixed(0)}K`;
  return `LKR ${Math.round(n).toLocaleString('en-US')}`;
}

function formatLKRFull(n: number) {
  return `LKR ${Math.round(n).toLocaleString('en-US')}`;
}

// ---------------------------------------------------------------------------
// Status config (pie colours match the rest of the UI)
// ---------------------------------------------------------------------------

const STATUS_META: Record<string, { label: string; colour: string }> = {
  received:      { label: 'Received',      colour: '#6b7280' },
  diagnosing:    { label: 'Diagnosing',    colour: '#d97706' },
  waiting_parts: { label: 'Waiting Parts', colour: '#ea580c' },
  in_progress:   { label: 'In Progress',   colour: '#2563eb' },
  quality_check: { label: 'Quality Check', colour: '#4f46e5' },
  ready:         { label: 'Ready',         colour: '#16a34a' },
  delivered:     { label: 'Delivered',     colour: '#7c3aed' },
  cancelled:     { label: 'Cancelled',     colour: '#dc2626' },
};

const TECH_COLOURS = [
  '#7c3aed', '#4f46e5', '#2563eb', '#0891b2', '#059669',
  '#65a30d', '#d97706', '#ea580c', '#dc2626', '#db2777',
];

// ---------------------------------------------------------------------------
// Custom tooltips
// ---------------------------------------------------------------------------

function RevenueTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-lg text-sm">
      <p className="font-medium text-gray-700 mb-0.5">{label}</p>
      <p className="font-bold text-blue-600">{formatLKRFull(Number(payload[0].value ?? 0))}</p>
    </div>
  );
}

function CountTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-lg text-sm">
      <p className="font-medium text-gray-700 mb-0.5">{label}</p>
      <p className="font-bold text-blue-600">{payload[0].value} jobs</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card wrapper
// ---------------------------------------------------------------------------

function ChartCard({ title, subtitle, children, empty }: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  empty?: boolean;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
      <div className="px-4 py-5">
        {empty ? (
          <div className="flex items-center justify-center h-48 text-sm text-gray-400">
            No data for this period
          </div>
        ) : children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chart 1 — Revenue by month (bar)
// ---------------------------------------------------------------------------

function RevenueChart({ data }: { data: ReportsData['revenueByMonth'] }) {
  const hasData = data.some((d) => d.revenue > 0);
  return (
    <ChartCard
      title="Revenue by Month"
      subtitle="Sum of paid invoices"
      empty={!hasData}
    >
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tickFormatter={formatLKR}
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            width={72}
          />
          <Tooltip content={RevenueTooltip} cursor={{ fill: '#f5f3ff' }} />
          <Bar dataKey="revenue" fill="#7c3aed" radius={[4, 4, 0, 0]} maxBarSize={48} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// Chart 2 — Work orders by status (pie)
// ---------------------------------------------------------------------------

function StatusPie({ data }: { data: ReportsData['workOrdersByStatus'] }) {
  const total = data.reduce((s, d) => s + d.count, 0);

  const renderLabel = (props: PieLabelRenderProps) => {
    const { cx = 0, cy = 0, midAngle = 0, innerRadius = 0, outerRadius = 0, percent = 0 } = props;
    if (percent < 0.05) return null;
    const RADIAN = Math.PI / 180;
    const r = Number(innerRadius) + (Number(outerRadius) - Number(innerRadius)) * 0.55;
    const x = Number(cx) + r * Math.cos(-Number(midAngle) * RADIAN);
    const y = Number(cy) + r * Math.sin(-Number(midAngle) * RADIAN);
    return (
      <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central"
        fontSize={11} fontWeight={600}>
        {Math.round(percent * 100)}%
      </text>
    );
  };

  return (
    <ChartCard
      title="Work Orders by Status"
      subtitle={total ? `${total} total in period` : undefined}
      empty={total === 0}
    >
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={data}
            dataKey="count"
            nameKey="status"
            cx="50%"
            cy="46%"
            outerRadius={90}
            labelLine={false}
            label={renderLabel}
          >
            {data.map((entry) => (
              <Cell
                key={entry.status}
                fill={STATUS_META[entry.status]?.colour ?? '#6b7280'}
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, name) => [
              `${Number(value)} jobs`,
              STATUS_META[String(name)]?.label ?? String(name),
            ]}
          />
          <Legend
            formatter={(value) => STATUS_META[value]?.label ?? value}
            iconSize={10}
            iconType="circle"
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// Chart 3 — Top 10 most used parts (horizontal bar)
// ---------------------------------------------------------------------------

function TopPartsChart({ data }: { data: ReportsData['topParts'] }) {
  // Truncate long names for the axis, keep full name in tooltip
  const chartData = data.map((d) => ({
    ...d,
    label: d.name.length > 22 ? d.name.slice(0, 20) + '…' : d.name,
  }));

  return (
    <ChartCard
      title="Top 10 Most Used Parts"
      subtitle="By quantity across work orders in period"
      empty={data.length === 0}
    >
      <ResponsiveContainer width="100%" height={Math.max(260, data.length * 36 + 20)}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 4, right: 40, left: 4, bottom: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ fontSize: 11, fill: '#374151' }}
            tickLine={false}
            axisLine={false}
            width={148}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as (typeof chartData)[number];
              return (
                <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-lg text-sm">
                  <p className="font-medium text-gray-700 mb-0.5">{d.name}</p>
                  {d.part_number && <p className="text-xs text-gray-400 mb-1 font-mono">{d.part_number}</p>}
                  <p className="font-bold text-blue-600">{payload[0].value} used</p>
                </div>
              );
            }}
            cursor={{ fill: '#f5f3ff' }}
          />
          <Bar dataKey="total_used" fill="#7c3aed" radius={[0, 4, 4, 0]} maxBarSize={22}
            label={{ position: 'right', fontSize: 11, fill: '#6b7280' }}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// Chart 4 — Jobs per technician (bar)
// ---------------------------------------------------------------------------

function TechnicianChart({ data }: { data: ReportsData['jobsByTechnician'] }) {
  return (
    <ChartCard
      title="Jobs per Technician"
      subtitle="Work orders created in period"
      empty={data.length === 0}
    >
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            angle={-30}
            textAnchor="end"
            interval={0}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            width={32}
          />
          <Tooltip content={CountTooltip} cursor={{ fill: '#f5f3ff' }} />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={52}>
            {data.map((_, i) => (
              <Cell key={i} fill={TECH_COLOURS[i % TECH_COLOURS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// Skeleton loaders
// ---------------------------------------------------------------------------

function ChartSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden animate-pulse">
      <div className="px-6 py-4 border-b border-gray-100">
        <div className="h-3.5 w-36 bg-gray-100 rounded" />
      </div>
      <div className="px-4 py-5">
        <div className="h-64 bg-gray-50 rounded-lg" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Date range controls
// ---------------------------------------------------------------------------

function DateRangeBar({
  from, to,
  onChange,
}: {
  from: string; to: string;
  onChange: (from: string, to: string) => void;
}) {
  const [localFrom, setLocalFrom] = useState(from);
  const [localTo,   setLocalTo]   = useState(to);

  function applyPreset(months: number) {
    const now = new Date();
    const f   = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1)
      .toISOString().slice(0, 10);
    const t   = now.toISOString().slice(0, 10);
    setLocalFrom(f);
    setLocalTo(t);
    onChange(f, t);
  }

  function handleApply() {
    if (localFrom && localTo && localFrom <= localTo) onChange(localFrom, localTo);
  }

  const inputCls = 'px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Presets */}
      {[
        { label: 'Last 3 months',  months: 3  },
        { label: 'Last 6 months',  months: 6  },
        { label: 'Last 12 months', months: 12 },
      ].map(({ label, months }) => (
        <button
          key={months}
          onClick={() => applyPreset(months)}
          className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200
            rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-colors"
        >
          {label}
        </button>
      ))}

      <span className="w-px h-5 bg-gray-200" />

      {/* Custom range */}
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={localFrom}
          max={localTo}
          onChange={(e) => setLocalFrom(e.target.value)}
          className={inputCls}
        />
        <span className="text-xs text-gray-400">to</span>
        <input
          type="date"
          value={localTo}
          min={localFrom}
          onChange={(e) => setLocalTo(e.target.value)}
          className={inputCls}
        />
        <button
          onClick={handleApply}
          className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600
            rounded-lg hover:bg-blue-700 transition-colors"
        >
          Apply
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary KPI strip (derived from reports data)
// ---------------------------------------------------------------------------

function KpiStrip({ data }: { data: ReportsData }) {
  const totalRevenue = data.revenueByMonth.reduce((s, d) => s + d.revenue, 0);
  const totalJobs    = data.workOrdersByStatus.reduce((s, d) => s + d.count, 0);
  const delivered    = data.workOrdersByStatus.find((d) => d.status === 'delivered')?.count ?? 0;
  const completionRate = totalJobs ? Math.round((delivered / totalJobs) * 100) : 0;
  const topPart      = data.topParts[0];

  const kpis = [
    { label: 'Total Revenue',    value: formatLKRFull(totalRevenue) },
    { label: 'Total Jobs',       value: totalJobs.toLocaleString() },
    { label: 'Completion Rate',  value: `${completionRate}%` },
    { label: 'Top Part',         value: topPart?.name ?? '—' },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {kpis.map(({ label, value }) => (
        <div key={label} className="bg-white rounded-xl border border-gray-200 px-5 py-4">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">{label}</p>
          <p className="text-lg font-bold text-gray-900 truncate" title={value}>{value}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Accounts receivable aging — customer outstanding balances by age bucket
// ---------------------------------------------------------------------------

const AGING_BUCKETS: { key: keyof AgingReportData['totals']; label: string }[] = [
  { key: 'current',      label: 'Current' },
  { key: 'days_1_30',    label: '1–30 days' },
  { key: 'days_31_60',   label: '31–60 days' },
  { key: 'days_61_90',   label: '61–90 days' },
  { key: 'days_over_90', label: '90+ days' },
];

function agingRowClass(row: AgingCustomerRow) {
  if (row.days_over_90 > 0) return 'text-red-600 font-semibold';
  if (row.days_61_90 > 0)   return 'text-orange-600 font-medium';
  return '';
}

// ---------------------------------------------------------------------------
// Quick-settle modal — lists a customer's outstanding invoices so payments
// can be recorded without opening each invoice individually.
// ---------------------------------------------------------------------------

function SettleModal({ customer, onClose }: { customer: AgingCustomerRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [payInvoice, setPayInvoice] = useState<AgingInvoiceRow | null>(null);

  const payMutation = useMutation({
    mutationFn: ({ invoiceId, method, reference }: { invoiceId: string; method: PaymentMethod; reference: string }) =>
      api.patch(`/api/invoices/${invoiceId}/pay`, {
        payment_method:    method,
        payment_reference: reference || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports', 'aging'] });
      setPayInvoice(null);
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative bg-white rounded-2xl shadow-xl p-6 w-full max-w-md max-h-[80vh] overflow-y-auto">
        <h3 className="text-base font-semibold text-gray-900">{customer.name}</h3>
        <p className="text-xs text-gray-400 mb-4">Outstanding invoices — select one to settle</p>

        <div className="space-y-2">
          {customer.invoices.map((inv) => (
            <div key={inv.id}
              className="flex items-center justify-between gap-3 px-3 py-2.5 border border-gray-200 rounded-lg">
              <div className="min-w-0">
                <p className="text-sm font-mono font-semibold text-gray-900">{inv.invoice_number}</p>
                <p className="text-xs text-gray-400 truncate">
                  {inv.due_date ? (
                    <>
                      Due {new Date(inv.due_date).toLocaleDateString('en-LK', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {' · '}{inv.age_days > 0 ? `${inv.age_days}d overdue` : 'Not yet due'}
                    </>
                  ) : (
                    `No due date · ${inv.age_days}d since invoice`
                  )}
                </p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="text-sm font-bold text-gray-900 tabular-nums">{formatLKRFull(inv.total)}</span>
                <button
                  onClick={() => setPayInvoice(inv)}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-green-600 rounded-lg
                    hover:bg-green-700 transition-colors whitespace-nowrap"
                >
                  Mark Paid
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end mt-5">
          <button onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
            Close
          </button>
        </div>
      </div>

      {payInvoice && (
        <PayDialog
          title={`Mark ${payInvoice.invoice_number} as Paid`}
          onConfirm={(method, reference) => payMutation.mutate({ invoiceId: payInvoice.id, method, reference })}
          onCancel={() => setPayInvoice(null)}
          isPending={payMutation.isPending}
        />
      )}
    </div>
  );
}

function AgingReport() {
  const navigate = useNavigate();
  const [settleCustomer, setSettleCustomer] = useState<AgingCustomerRow | null>(null);

  const { data, isLoading, isError } = useQuery<AgingReportData>({
    queryKey: ['reports', 'aging'],
    queryFn: () => api.get('/api/reports/aging').then((r) => r.data.data),
    staleTime: 60_000,
  });

  if (isError) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
        Failed to load the outstanding payments report. Please try again.
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 px-5 py-4 animate-pulse">
              <div className="h-2.5 w-20 bg-gray-100 rounded mb-2" />
              <div className="h-5 w-24 bg-gray-100 rounded" />
            </div>
          ))}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden animate-pulse">
          <div className="h-64 bg-gray-50" />
        </div>
      </div>
    );
  }

  const { customers, totals } = data;

  return (
    <div className="space-y-6">
      {/* Bucket KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        {AGING_BUCKETS.map(({ key, label }) => (
          <div key={key} className="bg-white rounded-xl border border-gray-200 px-5 py-4">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">{label}</p>
            <p className={`text-lg font-bold ${key === 'days_over_90' && totals[key] > 0 ? 'text-red-600' : 'text-gray-900'}`}>
              {formatLKRFull(totals[key])}
            </p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Outstanding Payments by Customer</h2>
            <p className="text-xs text-gray-400 mt-0.5">Unpaid (sent / overdue) invoices, snapshot as of today</p>
          </div>
          <p className="text-sm font-bold text-gray-900">{formatLKRFull(totals.total_outstanding)} total</p>
        </div>

        {customers.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-gray-400">
            No outstanding invoices — everything is paid up.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-400 uppercase tracking-wider">
                  <th className="px-6 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium text-center">Invoices</th>
                  <th className="px-4 py-3 font-medium text-right">Current</th>
                  <th className="px-4 py-3 font-medium text-right">1–30d</th>
                  <th className="px-4 py-3 font-medium text-right">31–60d</th>
                  <th className="px-4 py-3 font-medium text-right">61–90d</th>
                  <th className="px-4 py-3 font-medium text-right">90+ d</th>
                  <th className="px-6 py-3 font-medium text-right">Total Outstanding</th>
                  <th className="px-4 py-3 font-medium text-right print:hidden">Settle</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((row) => (
                  <tr
                    key={row.customer_id}
                    onClick={() => navigate(`/customers/${row.customer_id}`)}
                    className="border-b border-gray-50 last:border-0 hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="px-6 py-3">
                      <p className="font-medium text-gray-900">{row.name}</p>
                      <p className="text-xs text-gray-400">{row.phone}</p>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-500">{row.invoice_count}</td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {row.current > 0 ? formatLKRFull(row.current) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {row.days_1_30 > 0 ? formatLKRFull(row.days_1_30) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {row.days_31_60 > 0 ? formatLKRFull(row.days_31_60) : '—'}
                    </td>
                    <td className={`px-4 py-3 text-right ${row.days_61_90 > 0 ? 'text-orange-600 font-medium' : 'text-gray-700'}`}>
                      {row.days_61_90 > 0 ? formatLKRFull(row.days_61_90) : '—'}
                    </td>
                    <td className={`px-4 py-3 text-right ${row.days_over_90 > 0 ? 'text-red-600 font-semibold' : 'text-gray-700'}`}>
                      {row.days_over_90 > 0 ? formatLKRFull(row.days_over_90) : '—'}
                    </td>
                    <td className={`px-6 py-3 text-right font-bold ${agingRowClass(row)}`}>
                      {formatLKRFull(row.total_outstanding)}
                    </td>
                    <td className="px-4 py-3 text-right print:hidden">
                      <button
                        onClick={(e) => { e.stopPropagation(); setSettleCustomer(row); }}
                        className="px-3 py-1.5 text-xs font-semibold text-green-700 border border-green-200
                          bg-green-50 rounded-lg hover:bg-green-100 transition-colors whitespace-nowrap"
                      >
                        Settle
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {settleCustomer && (
        <SettleModal customer={settleCustomer} onClose={() => setSettleCustomer(null)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function ReportsPage() {
  const [tab, setTab] = useState<'overview' | 'aging'>('overview');
  const [from, setFrom] = useState(defaultFrom);
  const [to,   setTo]   = useState(defaultTo);

  const { data, isLoading, isError } = useQuery<ReportsData>({
    queryKey: ['reports', from, to],
    queryFn: () =>
      api.get('/api/reports', { params: { from, to } }).then((r) => r.data.data),
    staleTime: 60_000,
  });

  const tabCls = (active: boolean) =>
    `px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
      active ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
    }`;

  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-7xl mx-auto space-y-6">

        {/* Company header — visible when printing, subtle on screen */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <CompanyHeader
            docTitle="REPORT"
            docNumber={tab === 'overview' ? `${from} – ${to}` : `As of ${defaultTo()}`}
          />
        </div>

        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Reports</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              {tab === 'overview'
                ? (data ? `${data.meta.from} → ${data.meta.to}` : 'Loading…')
                : 'Snapshot as of today'}
            </p>
          </div>
          {tab === 'overview' && (
            <DateRangeBar from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
          )}
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 bg-gray-50 border border-gray-200 rounded-xl p-1 w-fit print:hidden">
          <button className={tabCls(tab === 'overview')} onClick={() => setTab('overview')}>
            Overview
          </button>
          <button className={tabCls(tab === 'aging')} onClick={() => setTab('aging')}>
            Outstanding Payments
          </button>
        </div>

        {tab === 'aging' ? (
          <AgingReport />
        ) : (
          <>
            {isError && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
                Failed to load report data. Please try again.
              </div>
            )}

            {/* KPI strip */}
            {isLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="bg-white rounded-xl border border-gray-200 px-5 py-4 animate-pulse">
                    <div className="h-2.5 w-20 bg-gray-100 rounded mb-2" />
                    <div className="h-5 w-28 bg-gray-100 rounded" />
                  </div>
                ))}
              </div>
            ) : data ? (
              <KpiStrip data={data} />
            ) : null}

            {/* Row 1: Revenue (full width) */}
            {isLoading ? <ChartSkeleton /> : data ? (
              <RevenueChart data={data.revenueByMonth} />
            ) : null}

            {/* Row 2: Status pie + Technician bar (side by side) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {isLoading ? (
                <><ChartSkeleton /><ChartSkeleton /></>
              ) : data ? (
                <>
                  <StatusPie data={data.workOrdersByStatus} />
                  <TechnicianChart data={data.jobsByTechnician} />
                </>
              ) : null}
            </div>

            {/* Row 3: Top parts (full width) */}
            {isLoading ? <ChartSkeleton /> : data ? (
              <TopPartsChart data={data.topParts} />
            ) : null}
          </>
        )}

      </div>
    </AppLayout>
  );
}
