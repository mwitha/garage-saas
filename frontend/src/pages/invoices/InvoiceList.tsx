import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '../../components/AppLayout';
import api from '../../lib/api';
import type { InvoiceSummary, InvoiceStatus, InvoicesPage } from '../../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<InvoiceStatus, { label: string; cls: string }> = {
  draft:     { label: 'Draft',     cls: 'bg-gray-100 text-gray-600' },
  sent:      { label: 'Sent',      cls: 'bg-blue-100 text-blue-700' },
  paid:      { label: 'Paid',      cls: 'bg-green-100 text-green-700' },
  overdue:   { label: 'Overdue',   cls: 'bg-red-100 text-red-600' },
  cancelled: { label: 'Cancelled', cls: 'bg-gray-100 text-gray-400' },
};

type TabStatus = InvoiceStatus | 'all';

const TABS: { value: TabStatus; label: string }[] = [
  { value: 'all',       label: 'All' },
  { value: 'draft',     label: 'Draft' },
  { value: 'sent',      label: 'Sent' },
  { value: 'paid',      label: 'Paid' },
  { value: 'overdue',   label: 'Overdue' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatLKR(n: number) {
  return `LKR ${Math.round(n).toLocaleString('en-US')}`;
}

function formatDate(s: string) {
  return new Date(s).toLocaleDateString('en-LK', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function StatusBadge({ status }: { status: InvoiceStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function InvoiceList() {
  const navigate = useNavigate();
  const [tab, setTab]       = useState<TabStatus>('all');
  const [search, setSearch] = useState('');
  const [page, setPage]     = useState(1);

  const { data, isLoading } = useQuery<InvoicesPage>({
    queryKey: ['invoices', tab, search, page],
    queryFn: () =>
      api.get('/api/invoices', {
        params: {
          status: tab === 'all' ? undefined : tab,
          search: search || undefined,
          page,
          limit: 20,
        },
      }).then((r) => r.data.data),
  });

  const invoices   = data?.invoices ?? [];
  const totalPages = data ? Math.ceil(data.total / 20) : 1;

  function handleTabChange(t: TabStatus) {
    setTab(t);
    setPage(1);
  }

  function handleSearch(s: string) {
    setSearch(s);
    setPage(1);
  }

  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Invoices</h1>
            {data && (
              <p className="text-xs text-gray-400 mt-0.5">
                {data.total} invoice{data.total !== 1 ? 's' : ''}
              </p>
            )}
          </div>
          <div className="relative">
            <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" />
            </svg>
            <input
              type="text"
              placeholder="Search by number, customer, plate…"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg w-64
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 border-b border-gray-200">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => handleTabChange(t.value)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                tab === t.value
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {isLoading ? (
            <div className="divide-y divide-gray-100">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-6 py-4">
                  <div className="h-4 w-28 bg-gray-100 rounded animate-pulse" />
                  <div className="h-4 w-40 bg-gray-100 rounded animate-pulse" />
                  <div className="h-4 w-20 bg-gray-100 rounded animate-pulse ml-auto" />
                </div>
              ))}
            </div>
          ) : invoices.length === 0 ? (
            <div className="py-16 text-center">
              <svg className="w-10 h-10 text-gray-200 mx-auto mb-3" fill="none" viewBox="0 0 24 24"
                stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm text-gray-400">
                {tab === 'all' ? 'No invoices yet' : `No ${tab} invoices`}
              </p>
            </div>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  {['Invoice #', 'Customer', 'Vehicle', 'Work Order', 'Date', 'Total', 'Status', 'Payment'].map((h) => (
                    <th key={h}
                      className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {invoices.map((inv: InvoiceSummary) => (
                  <tr
                    key={inv.id}
                    onClick={() => navigate(`/invoices/${inv.id}`)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <td className="px-5 py-3.5">
                      <span className="text-sm font-mono font-semibold text-gray-800">
                        {inv.invoice_number}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-medium text-gray-900">{inv.customer_name}</p>
                      <p className="text-xs text-gray-400">{inv.customer_phone}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-sm font-mono text-gray-700">{inv.plate_number}</span>
                      <p className="text-xs text-gray-400">{inv.make} {inv.model}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-xs font-mono text-gray-500">{inv.order_number}</span>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-500 whitespace-nowrap">
                      {formatDate(inv.created_at)}
                    </td>
                    <td className="px-5 py-3.5 text-sm font-semibold text-gray-900 tabular-nums whitespace-nowrap">
                      {formatLKR(inv.total)}
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={inv.status} />
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-500 capitalize">
                      {inv.payment_method
                        ? inv.payment_method.replace('_', ' ')
                        : <span className="text-gray-300">—</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-40
                  disabled:cursor-not-allowed transition-colors"
              >
                ← Previous
              </button>
              <span className="text-xs text-gray-400">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-40
                  disabled:cursor-not-allowed transition-colors"
              >
                Next →
              </button>
            </div>
          )}
        </div>

      </div>
    </AppLayout>
  );
}
