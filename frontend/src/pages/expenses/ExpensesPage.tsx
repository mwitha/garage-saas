import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts';
import type { TooltipContentProps } from 'recharts';
import { AppLayout } from '../../components/AppLayout';
import api from '../../lib/api';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORIES = [
  'Rent / Lease', 'Utilities', 'Salaries', 'Spare Parts', 'Equipment',
  'Marketing', 'Insurance', 'Vehicle Fuel', 'Maintenance', 'Office Supplies', 'Other',
] as const;

const PAYMENT_METHODS = [
  { value: 'cash',          label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cheque',        label: 'Cheque' },
  { value: 'card',          label: 'Card' },
] as const;

const CATEGORY_COLOURS: Record<string, string> = {
  'Rent / Lease':   '#6366f1',
  'Utilities':      '#f59e0b',
  'Salaries':       '#10b981',
  'Spare Parts':    '#3b82f6',
  'Equipment':      '#8b5cf6',
  'Marketing':      '#f43f5e',
  'Insurance':      '#06b6d4',
  'Vehicle Fuel':   '#ef4444',
  'Maintenance':    '#84cc16',
  'Office Supplies':'#a78bfa',
  'Other':          '#94a3b8',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Category = typeof CATEGORIES[number];

interface Expense {
  id: string;
  date: string;
  category: Category;
  description: string;
  amount: number;
  payment_method: string;
  reference: string | null;
  notes: string | null;
  created_by_name: string | null;
}

interface ExpenseListData {
  rows: Expense[];
  total: number;
  page: number;
  pages: number;
}

interface CategoryTotal { category: string; total: number; count: number; }
interface MonthTotal    { month: string; total: number; }

interface ReportData {
  meta: { from: string; to: string; totalAmount: number; totalCount: number; dailyAvg: number };
  byCategory: CategoryTotal[];
  byMonth: MonthTotal[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number) {
  if (n >= 1_000_000) return `LKR ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `LKR ${(n / 1_000).toFixed(0)}K`;
  return `LKR ${Math.round(n).toLocaleString('en-US')}`;
}
function fmtFull(n: number) {
  return `LKR ${Math.round(n).toLocaleString('en-US')}`;
}
function apiErr(err: unknown): string {
  return (err as { response?: { data?: { error?: { message?: string } } } })
    ?.response?.data?.error?.message ?? 'Something went wrong';
}
function defaultFrom() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() - 1, 1).toISOString().slice(0, 10);
}
function defaultTo() {
  return new Date().toISOString().slice(0, 10);
}
function fmtDate(s: string) {
  return new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function pmLabel(v: string) {
  return PAYMENT_METHODS.find((m) => m.value === v)?.label ?? v;
}

// ---------------------------------------------------------------------------
// Zod schema + form components
// ---------------------------------------------------------------------------

const expenseSchema = z.object({
  date:           z.string().min(1, 'Date required'),
  category:       z.enum(CATEGORIES).refine((v) => !!v, 'Category required'),
  description:    z.string().min(1, 'Description required'),
  amount:         z.coerce.number({ error: 'Enter amount' }).positive('Must be > 0'),
  payment_method: z.enum(['cash', 'bank_transfer', 'cheque', 'card']).default('cash'),
  reference:      z.string().optional(),
  notes:          z.string().optional(),
});
type ExpenseForm = z.infer<typeof expenseSchema>;

const inputCls = (err?: string) =>
  `w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500
   ${err ? 'border-red-300' : 'border-gray-200'}`;

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {children}
      {error && <p className="text-xs text-red-500 mt-0.5">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expense modal (add / edit)
// ---------------------------------------------------------------------------

function ExpenseModal({
  expense,
  onClose,
}: {
  expense?: Expense;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!expense;

  const { register, handleSubmit, formState: { errors } } = useForm<ExpenseForm>({
    resolver: zodResolver(expenseSchema) as any,
    defaultValues: expense
      ? {
          date:           expense.date,
          category:       expense.category,
          description:    expense.description,
          amount:         expense.amount,
          payment_method: expense.payment_method as ExpenseForm['payment_method'],
          reference:      expense.reference ?? '',
          notes:          expense.notes ?? '',
        }
      : { date: new Date().toISOString().slice(0, 10), payment_method: 'cash' },
  });

  const saveMutation = useMutation({
    mutationFn: (data: ExpenseForm) =>
      isEdit
        ? api.patch(`/api/expenses/${expense!.id}`, data).then((r) => r.data.data)
        : api.post('/api/expenses', data).then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      onClose();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/expenses/${expense!.id}`).then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900">
            {isEdit ? 'Edit Expense' : 'Add Expense'}
          </h2>
          <button onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit((d) => saveMutation.mutate(d))} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date *" error={errors.date?.message}>
              <input type="date" {...register('date')} className={inputCls(errors.date?.message)} />
            </Field>
            <Field label="Amount (LKR) *" error={errors.amount?.message}>
              <input type="number" step="0.01" min="0" {...register('amount')} placeholder="0.00"
                className={inputCls(errors.amount?.message)} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Category *" error={errors.category?.message}>
              <select {...register('category')} className={inputCls(errors.category?.message)}>
                <option value="">Select…</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Payment Method" error={errors.payment_method?.message}>
              <select {...register('payment_method')} className={inputCls()}>
                {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Description *" error={errors.description?.message}>
            <input {...register('description')} autoFocus={!isEdit}
              placeholder="What was this expense for?"
              className={inputCls(errors.description?.message)} />
          </Field>

          <Field label="Reference / Receipt No.">
            <input {...register('reference')} placeholder="Optional" className={inputCls()} />
          </Field>

          <Field label="Notes">
            <textarea {...register('notes')} rows={2} placeholder="Optional"
              className={`${inputCls()} resize-none`} />
          </Field>

          {saveMutation.isError && (
            <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {apiErr(saveMutation.error)}
            </p>
          )}

          <div className="flex items-center justify-between pt-1">
            {isEdit ? (
              <button type="button"
                onClick={() => { if (confirm('Delete this expense?')) deleteMutation.mutate(); }}
                disabled={deleteMutation.isPending}
                className="text-xs font-medium text-red-500 hover:text-red-700 transition-colors disabled:opacity-60">
                Delete
              </button>
            ) : <span />}
            <div className="flex gap-3">
              <button type="button" onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
                Cancel
              </button>
              <button type="submit" disabled={saveMutation.isPending}
                className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg
                  hover:bg-blue-700 disabled:opacity-60 transition-colors">
                {saveMutation.isPending ? 'Saving…' : isEdit ? 'Save' : 'Add Expense'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category badge
// ---------------------------------------------------------------------------

function CategoryBadge({ category }: { category: string }) {
  const colour = CATEGORY_COLOURS[category] ?? '#94a3b8';
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-white whitespace-nowrap"
      style={{ backgroundColor: colour }}
    >
      {category}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Expenses list tab
// ---------------------------------------------------------------------------

function ExpensesList() {
  const [from, setFrom]       = useState(defaultFrom);
  const [to, setTo]           = useState(defaultTo);
  const [category, setCategory] = useState('');
  const [page, setPage]       = useState(1);
  const [modal, setModal]     = useState<'add' | Expense | null>(null);

  const { data, isLoading } = useQuery<ExpenseListData>({
    queryKey: ['expenses', 'list', from, to, category, page],
    queryFn: () =>
      api.get('/api/expenses', { params: { from, to, category: category || undefined, page } })
        .then((r) => r.data.data),
  });

  const rows  = data?.rows  ?? [];
  const total = data?.total ?? 0;
  const pages = data?.pages ?? 1;

  function handleFilterChange() {
    setPage(1);
  }

  return (
    <>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500">From</label>
          <input type="date" value={from}
            onChange={(e) => { setFrom(e.target.value); handleFilterChange(); }}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500">To</label>
          <input type="date" value={to}
            onChange={(e) => { setTo(e.target.value); handleFilterChange(); }}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <select
          value={category}
          onChange={(e) => { setCategory(e.target.value); handleFilterChange(); }}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="ml-auto">
          <button
            onClick={() => setModal('add')}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white
              bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Expense
          </button>
        </div>
      </div>

      {/* Summary strip */}
      {!isLoading && total > 0 && (
        <div className="text-xs text-gray-500">
          {total} expense{total !== 1 ? 's' : ''} found
          {' · '}
          <span className="font-semibold text-gray-900">
            {fmtFull(rows.reduce((s, r) => s + r.amount, 0))} on this page
          </span>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-12 bg-white rounded-xl border border-gray-200 animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 flex flex-col items-center justify-center h-48 text-sm text-gray-400 gap-2">
          <svg className="w-8 h-8 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
          </svg>
          No expenses found for the selected filters
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Date</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Category</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Description</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Method</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Amount</th>
                <th className="px-5 py-3 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((exp) => (
                <tr key={exp.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3.5 text-sm text-gray-700 whitespace-nowrap">
                    {fmtDate(exp.date)}
                  </td>
                  <td className="px-5 py-3.5">
                    <CategoryBadge category={exp.category} />
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="text-sm text-gray-900">{exp.description}</p>
                    {exp.reference && (
                      <p className="text-xs text-gray-400 mt-0.5">Ref: {exp.reference}</p>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="text-xs text-gray-500">{pmLabel(exp.payment_method)}</span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <span className="text-sm font-semibold text-gray-900">{fmtFull(exp.amount)}</span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <button
                      onClick={() => setModal(exp)}
                      className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          {pages > 1 && (
            <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
              <span className="text-xs text-gray-400">Page {page} of {pages}</span>
              <div className="flex gap-2">
                <button
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="px-3 py-1 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg
                    hover:bg-gray-50 disabled:opacity-40 transition-colors"
                >
                  Previous
                </button>
                <button
                  disabled={page === pages}
                  onClick={() => setPage((p) => p + 1)}
                  className="px-3 py-1 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg
                    hover:bg-gray-50 disabled:opacity-40 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {modal === 'add' && <ExpenseModal onClose={() => setModal(null)} />}
      {modal && modal !== 'add' && (
        <ExpenseModal expense={modal as Expense} onClose={() => setModal(null)} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Report tab
// ---------------------------------------------------------------------------

function ReportTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-lg text-sm">
      <p className="font-medium text-gray-700 mb-0.5">{label}</p>
      <p className="font-bold text-blue-600">{fmtFull(Number(payload[0].value ?? 0))}</p>
    </div>
  );
}

function ExpensesReport() {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo]     = useState(defaultTo);

  const { data, isLoading } = useQuery<ReportData>({
    queryKey: ['expenses', 'report', from, to],
    queryFn: () =>
      api.get('/api/expenses/report', { params: { from, to } }).then((r) => r.data.data),
  });

  const meta       = data?.meta;
  const byCategory = data?.byCategory ?? [];
  const byMonth    = data?.byMonth    ?? [];
  const topCat     = byCategory[0]?.category ?? '—';

  return (
    <div className="space-y-5">
      {/* Date range */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 bg-white rounded-xl border border-gray-200 animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Total Expenses',    value: fmtFull(meta?.totalAmount ?? 0), accent: true  },
              { label: 'Transactions',      value: meta?.totalCount ?? 0,           accent: false },
              { label: 'Daily Average',     value: fmt(meta?.dailyAvg ?? 0),        accent: false },
              { label: 'Top Category',      value: topCat,                          accent: false },
            ].map(({ label, value, accent }) => (
              <div key={label} className="bg-white rounded-xl border border-gray-200 px-5 py-4 text-center">
                <p className={`text-lg font-bold truncate ${accent ? 'text-red-500' : 'text-gray-900'}`}>{value}</p>
                <p className="text-xs text-gray-400 mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {byCategory.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 flex items-center justify-center h-32 text-sm text-gray-400">
              No expenses in this period
            </div>
          ) : (
            <>
              {/* By-category bar chart */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900">Expenses by Category</h3>
                </div>
                <div className="px-4 py-5">
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart
                      data={byCategory}
                      layout="vertical"
                      margin={{ top: 0, right: 60, left: 110, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
                      <XAxis type="number" tickFormatter={fmt}
                        tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="category"
                        tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} width={110} />
                      <Tooltip content={ReportTooltip} cursor={{ fill: '#f8fafc' }} />
                      <Bar dataKey="total" radius={[0, 4, 4, 0]} maxBarSize={28}>
                        {byCategory.map((entry) => (
                          <Cell key={entry.category} fill={CATEGORY_COLOURS[entry.category] ?? '#94a3b8'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Monthly trend */}
              {byMonth.length > 1 && (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-100">
                    <h3 className="text-sm font-semibold text-gray-900">Monthly Trend</h3>
                  </div>
                  <div className="px-4 py-5">
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={byMonth} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                        <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                        <YAxis tickFormatter={fmt} tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={72} />
                        <Tooltip content={ReportTooltip} cursor={{ fill: '#fef2f2' }} />
                        <Bar dataKey="total" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={48} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Category breakdown table */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900">Category Breakdown</h3>
                </div>
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Category</th>
                      <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center">Transactions</th>
                      <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Total</th>
                      <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider w-40">Share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {byCategory.map((row) => {
                      const share = (meta?.totalAmount ?? 0) > 0
                        ? (row.total / meta!.totalAmount) * 100
                        : 0;
                      return (
                        <tr key={row.category} className="hover:bg-gray-50 transition-colors">
                          <td className="px-5 py-3.5">
                            <CategoryBadge category={row.category} />
                          </td>
                          <td className="px-5 py-3.5 text-center text-sm text-gray-600">{row.count}</td>
                          <td className="px-5 py-3.5 text-right">
                            <span className="text-sm font-semibold text-gray-900">{fmtFull(row.total)}</span>
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${share}%`,
                                    backgroundColor: CATEGORY_COLOURS[row.category] ?? '#94a3b8',
                                  }}
                                />
                              </div>
                              <span className="text-xs font-medium text-gray-500 w-9 text-right">
                                {share.toFixed(0)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Tab = 'list' | 'report';

export function ExpensesPage() {
  const [tab, setTab] = useState<Tab>('list');

  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-5xl mx-auto space-y-6">

        <div>
          <h1 className="text-lg font-semibold text-gray-900">Expenses</h1>
          <p className="text-xs text-gray-400 mt-0.5">Track daily workshop expenses and analyse spending</p>
        </div>

        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
          {([['list', 'Expenses'], ['report', 'Report']] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                tab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'list'   && <ExpensesList />}
        {tab === 'report' && <ExpensesReport />}

      </div>
    </AppLayout>
  );
}
