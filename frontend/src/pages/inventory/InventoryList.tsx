import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AppLayout } from '../../components/AppLayout';
import { InventoryFormModal, itemToFormData } from '../../components/inventory/InventoryFormModal';
import type { InventoryFormData } from '../../components/inventory/InventoryFormModal';
import { StockAdjustModal } from '../../components/inventory/StockAdjustModal';
import api from '../../lib/api';
import type { InventoryItem, InventoryPage, StockAdjustment } from '../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatLKR(n: number) {
  return `LKR ${Math.round(n).toLocaleString('en-US')}`;
}

function apiErrMsg(err: unknown) {
  return (err as { response?: { data?: { error?: { message?: string } } } })
    ?.response?.data?.error?.message ?? 'Something went wrong';
}

const CATEGORIES = ['Engine', 'Brakes', 'Filters', 'AC Parts', 'Electrical', 'Body', 'Lubricants', 'Tyres', 'Other'];

// ---------------------------------------------------------------------------
// Summary card
// ---------------------------------------------------------------------------

function SummaryCard({
  label, value, sub, accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: 'red' | 'amber';
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${
        accent === 'red' ? 'text-red-600' : accent === 'amber' ? 'text-amber-600' : 'text-gray-900'
      }`}>
        {value}
      </p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stock quantity cell
// ---------------------------------------------------------------------------

function StockCell({ quantity, threshold }: { quantity: number; threshold: number }) {
  if (threshold > 0 && quantity <= 0) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-semibold text-red-600 tabular-nums">{quantity}</span>
        <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 font-medium">Out</span>
      </div>
    );
  }
  if (threshold > 0 && quantity <= threshold) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-semibold text-red-500 tabular-nums">{quantity}</span>
        <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 font-medium">Low</span>
      </div>
    );
  }
  return <span className="text-sm text-gray-700 tabular-nums">{quantity}</span>;
}

// ---------------------------------------------------------------------------
// Delete confirmation dialog
// ---------------------------------------------------------------------------

function DeleteDialog({
  item, onConfirm, onCancel, isPending, error,
}: {
  item: InventoryItem;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
  error?: string | null;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} aria-hidden />
      <div className="relative bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
        <h3 className="text-base font-semibold text-gray-900 mb-2">Delete part?</h3>
        <p className="text-sm text-gray-500">
          <strong>{item.name}</strong>{item.part_number ? ` (${item.part_number})` : ''} will be permanently removed.
        </p>
        {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
        <div className="flex gap-3 justify-end mt-5">
          <button onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={isPending}
            className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg
              hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors">
            {isPending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stock history slide-over
// ---------------------------------------------------------------------------

function StockHistoryPanel({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const { data: history, isLoading } = useQuery<StockAdjustment[]>({
    queryKey: ['stock-history', item.id],
    queryFn: () => api.get(`/api/inventory/${item.id}/history`).then((r) => r.data.data),
  });

  function formatDate(s: string) {
    return new Date(s).toLocaleString('en-LK', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Stock history</h2>
            <p className="text-sm text-gray-500 mt-0.5 truncate max-w-[300px]">{item.name}</p>
            {item.part_number && (
              <p className="text-xs font-mono text-gray-400">{item.part_number}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg transition-colors flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Current stock */}
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex-shrink-0">
          <p className="text-xs text-gray-400">Current stock</p>
          <p className={`text-lg font-bold tabular-nums ${item.low_stock ? 'text-red-600' : 'text-gray-900'}`}>
            {item.quantity}
            <span className="text-sm font-normal text-gray-400 ml-1">{item.unit}</span>
            {item.low_stock && <span className="ml-2 text-xs text-red-500 font-medium">· Low stock</span>}
          </p>
        </div>

        {/* Adjustments list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="divide-y divide-gray-100">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="px-5 py-4 flex gap-3">
                  <div className="h-8 w-8 bg-gray-100 rounded-lg animate-pulse flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 w-32 bg-gray-100 rounded animate-pulse" />
                    <div className="h-3 w-48 bg-gray-100 rounded animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : !history || history.length === 0 ? (
            <div className="py-16 text-center">
              <svg className="w-8 h-8 text-gray-200 mx-auto mb-2" fill="none" viewBox="0 0 24 24"
                stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-gray-400">No adjustments recorded yet</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {history.map((adj) => {
                const isPositive = adj.quantity_change > 0;
                return (
                  <div key={adj.id} className="px-5 py-3.5 flex items-start gap-3">
                    {/* Change badge */}
                    <div className={`flex-shrink-0 w-10 h-8 rounded-lg flex items-center justify-center text-sm font-bold tabular-nums ${
                      isPositive
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-red-50 text-red-600'
                    }`}>
                      {isPositive ? '+' : '−'}{Math.abs(adj.quantity_change)}
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm text-gray-800 leading-snug">
                          {adj.note ?? <span className="text-gray-400 italic">No note</span>}
                        </p>
                        <p className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">
                          {formatDate(adj.created_at)}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
                        {adj.adjusted_by_name && (
                          <span className="text-xs text-gray-400">{adj.adjusted_by_name}</span>
                        )}
                        {adj.reference_number && (
                          <span className="text-xs font-mono text-gray-400">
                            Ref: {adj.reference_number}
                          </span>
                        )}
                        {adj.work_order_id && adj.work_order_number && (
                          <Link
                            to={`/work-orders/${adj.work_order_id}`}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                            onClick={onClose}
                          >
                            WO #{adj.work_order_number}
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function InventoryList() {
  const queryClient = useQueryClient();

  const [search, setSearch]       = useState('');
  const [category, setCategory]   = useState('');
  const [lowOnly, setLowOnly]     = useState(false);
  const [page, setPage]           = useState(1);

  const [formOpen, setFormOpen]         = useState(false);
  const [editItem, setEditItem]         = useState<InventoryItem | null>(null);
  const [adjustItem, setAdjustItem]     = useState<InventoryItem | null>(null);
  const [historyItem, setHistoryItem]   = useState<InventoryItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InventoryItem | null>(null);

  // Main paginated list
  const { data, isLoading } = useQuery<InventoryPage>({
    queryKey: ['inventory', search, category, lowOnly, page],
    queryFn: () =>
      api.get('/api/inventory', {
        params: {
          search:   search || undefined,
          category: category || undefined,
          lowStock: lowOnly ? 'true' : undefined,
          page,
          limit: 50,
        },
      }).then((r) => r.data.data),
  });

  // Unfiltered stats for summary cards
  const { data: statsData } = useQuery<InventoryPage>({
    queryKey: ['inventory-stats'],
    queryFn: () =>
      api.get('/api/inventory', { params: { limit: 500 } }).then((r) => r.data.data),
    staleTime: 30_000,
  });

  // Low-stock items for the alert badge
  const { data: lowStockData } = useQuery<InventoryItem[]>({
    queryKey: ['inventory-low-stock-count'],
    queryFn: () => api.get('/api/inventory/low-stock').then((r) => r.data.data),
    staleTime: 60_000,
  });

  const totalParts      = statsData?.total ?? 0;
  const lowStockCount   = lowStockData?.length ?? 0;
  const totalStockValue = (statsData?.items ?? []).reduce(
    (sum, item) => sum + item.quantity * item.cost_price, 0,
  );

  // Mutations
  const createMutation = useMutation({
    mutationFn: (body: InventoryFormData) =>
      api.post('/api/inventory', body).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setFormOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (body: InventoryFormData) =>
      api.put(`/api/inventory/${editItem!.id}`, body).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setEditItem(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      api.delete(`/api/inventory/${deleteTarget!.id}`).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-low-stock-count'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-stats'] });
      setDeleteTarget(null);
    },
  });

  const items      = data?.items ?? [];
  const total      = data?.total ?? 0;
  const totalPages = Math.ceil(total / 50) || 1;

  function resetFilters() {
    setSearch(''); setCategory(''); setLowOnly(false); setPage(1);
  }

  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-7xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Inventory</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Manage parts, stock levels, and pricing
            </p>
          </div>
          <button
            onClick={() => { createMutation.reset(); setFormOpen(true); }}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white
              bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Part
          </button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          <SummaryCard
            label="Total parts"
            value={totalParts.toLocaleString()}
            sub="distinct SKUs in inventory"
          />
          <SummaryCard
            label="Low stock items"
            value={lowStockCount}
            sub={lowStockCount > 0 ? 'need restocking' : 'all levels OK'}
            accent={lowStockCount > 0 ? 'red' : undefined}
          />
          <SummaryCard
            label="Total stock value"
            value={formatLKR(totalStockValue)}
            sub="cost price × quantity"
          />
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" />
            </svg>
            <input
              type="text"
              placeholder="Search name or part number…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Category */}
          <select
            value={category}
            onChange={(e) => { setCategory(e.target.value); setPage(1); }}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-700"
          >
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Low stock toggle */}
          <button
            onClick={() => { setLowOnly((v) => !v); setPage(1); }}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
              lowOnly
                ? 'bg-red-50 border-red-300 text-red-700'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Low stock only
            {lowStockCount > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                lowOnly ? 'bg-red-200 text-red-800' : 'bg-red-100 text-red-600'
              }`}>
                {lowStockCount}
              </span>
            )}
          </button>

          {/* Clear filters */}
          {(search || category || lowOnly) && (
            <button
              onClick={resetFilters}
              className="text-sm text-gray-400 hover:text-gray-700 transition-colors"
            >
              Clear filters
            </button>
          )}

          <span className="ml-auto text-xs text-gray-400">
            {total.toLocaleString()} result{total !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {isLoading ? (
            <div className="divide-y divide-gray-100">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-3.5">
                  <div className="h-4 w-40 bg-gray-100 rounded animate-pulse" />
                  <div className="h-4 w-24 bg-gray-100 rounded animate-pulse" />
                  <div className="h-4 w-16 bg-gray-100 rounded animate-pulse ml-auto" />
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center">
              <svg className="w-10 h-10 text-gray-200 mx-auto mb-3" fill="none" viewBox="0 0 24 24"
                stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              <p className="text-sm text-gray-400">
                {search || category || lowOnly
                  ? 'No items match your filters.'
                  : 'No inventory items yet.'}
              </p>
              {!search && !category && !lowOnly && (
                <button
                  onClick={() => setFormOpen(true)}
                  className="mt-3 text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  Add your first part →
                </button>
              )}
            </div>
          ) : (
            <>
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    {['Part name', 'Part #', 'Category', 'Unit', 'Qty', 'Reorder at', 'Selling price', 'Supplier', ''].map((h) => (
                      <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      className={`transition-colors ${
                        item.low_stock
                          ? 'bg-red-50/60 hover:bg-red-50'
                          : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className="px-4 py-3 max-w-[200px]">
                        <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                        {item.location && (
                          <p className="text-xs text-gray-400 truncate">{item.location}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-mono text-gray-500">
                          {item.part_number || <span className="text-gray-300">—</span>}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {item.category ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
                            {item.category}
                          </span>
                        ) : (
                          <span className="text-gray-300 text-sm">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{item.unit}</td>
                      <td className="px-4 py-3">
                        <StockCell quantity={item.quantity} threshold={item.reorder_threshold} />
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 tabular-nums">
                        {item.reorder_threshold}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-800 tabular-nums whitespace-nowrap">
                        {formatLKR(item.selling_price)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 max-w-[140px] truncate">
                        {item.supplier_name || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          {/* History */}
                          <button
                            onClick={() => setHistoryItem(item)}
                            className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
                            title="Stock history"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round"
                                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </button>
                          {/* Adjust */}
                          <button
                            onClick={() => setAdjustItem(item)}
                            className="p-1.5 text-gray-400 hover:text-emerald-600 rounded-lg hover:bg-emerald-50 transition-colors"
                            title="Adjust stock"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round"
                                d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                            </svg>
                          </button>
                          {/* Edit */}
                          <button
                            onClick={() => { updateMutation.reset(); setEditItem(item); }}
                            className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
                            title="Edit"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round"
                                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          {/* Delete */}
                          <button
                            onClick={() => { deleteMutation.reset(); setDeleteTarget(item); }}
                            className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"
                            title="Delete"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round"
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-40 transition-colors"
                  >
                    ← Previous
                  </button>
                  <span className="text-xs text-gray-400">Page {page} of {totalPages}</span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-40 transition-colors"
                  >
                    Next →
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Add form */}
      <InventoryFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Add Part"
        onSubmit={(d) => createMutation.mutate(d)}
        isPending={createMutation.isPending}
        error={createMutation.error ? apiErrMsg(createMutation.error) : null}
      />

      {/* Edit form */}
      <InventoryFormModal
        open={!!editItem}
        onClose={() => setEditItem(null)}
        title={`Edit · ${editItem?.name ?? ''}`}
        defaultValues={editItem ? itemToFormData(editItem) : undefined}
        onSubmit={(d) => updateMutation.mutate(d)}
        isPending={updateMutation.isPending}
        error={updateMutation.error ? apiErrMsg(updateMutation.error) : null}
      />

      {/* Stock adjust modal */}
      {adjustItem && (
        <StockAdjustModal
          item={adjustItem}
          onClose={() => setAdjustItem(null)}
        />
      )}

      {/* Delete dialog */}
      {deleteTarget && (
        <DeleteDialog
          item={deleteTarget}
          onConfirm={() => deleteMutation.mutate()}
          onCancel={() => setDeleteTarget(null)}
          isPending={deleteMutation.isPending}
          error={deleteMutation.error ? apiErrMsg(deleteMutation.error) : null}
        />
      )}

      {/* Stock history slide-over */}
      {historyItem && (
        <StockHistoryPanel
          item={historyItem}
          onClose={() => setHistoryItem(null)}
        />
      )}
    </AppLayout>
  );
}
