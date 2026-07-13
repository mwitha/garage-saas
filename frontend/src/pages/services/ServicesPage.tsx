import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '../../components/AppLayout';
import { ServiceFormModal, itemToFormData } from '../../components/services/ServiceFormModal';
import type { ServiceFormData } from '../../components/services/ServiceFormModal';
import api from '../../lib/api';
import type { ServiceItem, ServiceItemsPage } from '../../types';

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

const CATEGORIES = ['Maintenance', 'Repair', 'Diagnostics', 'Inspection', 'Detailing', 'Other'];

// ---------------------------------------------------------------------------
// Delete confirmation dialog
// ---------------------------------------------------------------------------

function DeleteDialog({
  item, onConfirm, onCancel, isPending, error,
}: {
  item: ServiceItem;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
  error?: string | null;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} aria-hidden />
      <div className="relative bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
        <h3 className="text-base font-semibold text-gray-900 mb-2">Delete service?</h3>
        <p className="text-sm text-gray-500">
          <strong>{item.name}</strong> will be permanently removed.
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
// Page
// ---------------------------------------------------------------------------

export function ServicesPage() {
  const queryClient = useQueryClient();

  const [search, setSearch]     = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage]         = useState(1);

  const [formOpen, setFormOpen]         = useState(false);
  const [editItem, setEditItem]         = useState<ServiceItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ServiceItem | null>(null);

  const { data, isLoading } = useQuery<ServiceItemsPage>({
    queryKey: ['service-items', search, category, page],
    queryFn: () =>
      api.get('/api/service-items', {
        params: {
          search:          search || undefined,
          category:        category || undefined,
          includeInactive: 'true',
          page,
          limit: 50,
        },
      }).then((r) => r.data.data),
  });

  const createMutation = useMutation({
    mutationFn: (body: ServiceFormData) =>
      api.post('/api/service-items', body).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-items'] });
      setFormOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (body: ServiceFormData) =>
      api.put(`/api/service-items/${editItem!.id}`, body).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-items'] });
      setEditItem(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      api.delete(`/api/service-items/${deleteTarget!.id}`).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-items'] });
      setDeleteTarget(null);
    },
  });

  const items      = data?.items ?? [];
  const total      = data?.total ?? 0;
  const totalPages = Math.ceil(total / 50) || 1;

  function resetFilters() {
    setSearch(''); setCategory(''); setPage(1);
  }

  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-7xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Services</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Manage your reusable labour &amp; service price list
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
            Add Service
          </button>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" />
            </svg>
            <input
              type="text"
              placeholder="Search services…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <select
            value={category}
            onChange={(e) => { setCategory(e.target.value); setPage(1); }}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-700"
          >
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          {(search || category) && (
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
              {Array.from({ length: 6 }).map((_, i) => (
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
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              <p className="text-sm text-gray-400">
                {search || category ? 'No services match your filters.' : 'No services yet.'}
              </p>
              {!search && !category && (
                <button
                  onClick={() => setFormOpen(true)}
                  className="mt-3 text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  Add your first service →
                </button>
              )}
            </div>
          ) : (
            <>
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    {['Service', 'Category', 'Price', 'Status', ''].map((h) => (
                      <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((item) => (
                    <tr key={item.id} className={`transition-colors hover:bg-gray-50 ${!item.active ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-3 max-w-[280px]">
                        <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                        {item.description && (
                          <p className="text-xs text-gray-400 truncate">{item.description}</p>
                        )}
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
                      <td className="px-4 py-3 text-sm font-medium text-gray-800 tabular-nums whitespace-nowrap">
                        {formatLKR(item.price)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          item.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {item.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
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

      <ServiceFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Add Service"
        onSubmit={(d) => createMutation.mutate(d)}
        isPending={createMutation.isPending}
        error={createMutation.error ? apiErrMsg(createMutation.error) : null}
      />

      <ServiceFormModal
        open={!!editItem}
        onClose={() => setEditItem(null)}
        title={`Edit · ${editItem?.name ?? ''}`}
        defaultValues={editItem ? itemToFormData(editItem) : undefined}
        onSubmit={(d) => updateMutation.mutate(d)}
        isPending={updateMutation.isPending}
        error={updateMutation.error ? apiErrMsg(updateMutation.error) : null}
      />

      {deleteTarget && (
        <DeleteDialog
          item={deleteTarget}
          onConfirm={() => deleteMutation.mutate()}
          onCancel={() => setDeleteTarget(null)}
          isPending={deleteMutation.isPending}
          error={deleteMutation.error ? apiErrMsg(deleteMutation.error) : null}
        />
      )}
    </AppLayout>
  );
}
