import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '../../components/AppLayout';
import { CustomerForm } from '../../components/customers/CustomerForm';
import type { CustomerFormData } from '../../components/customers/CustomerForm';
import { useDebounce } from '../../hooks/useDebounce';
import api from '../../lib/api';
import type { CustomersPage } from '../../types';

// ---- Helpers ---------------------------------------------------------------

const AVATAR_COLOURS = [
  'bg-blue-100 text-blue-700',
  'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-sky-100 text-sky-700',
];

function avatarColour(name: string) {
  return AVATAR_COLOURS[name.charCodeAt(0) % AVATAR_COLOURS.length];
}

function initials(name: string) {
  return name.split(' ').slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30)  return `${days}d ago`;
  if (days < 365) return d.toLocaleDateString('en-LK', { day: 'numeric', month: 'short' });
  return d.toLocaleDateString('en-LK', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ---- Skeleton row ----------------------------------------------------------

function SkeletonRow() {
  return (
    <tr>
      {[48, 28, 32, 12, 20].map((w, i) => (
        <td key={i} className="px-6 py-3.5">
          <div className={`h-3.5 bg-gray-100 rounded animate-pulse w-${w}`} />
        </td>
      ))}
    </tr>
  );
}

// ---- Pagination ------------------------------------------------------------

function Pagination({ page, total, limit, onChange }: {
  page: number; total: number; limit: number; onChange: (p: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 bg-white text-sm text-gray-500">
      <span>{total} customer{total !== 1 ? 's' : ''}</span>
      <div className="flex items-center gap-1">
        <button disabled={page === 1} onClick={() => onChange(page - 1)}
          className="px-2.5 py-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          ← Prev
        </button>
        <span className="px-3">{page} / {totalPages}</span>
        <button disabled={page === totalPages} onClick={() => onChange(page + 1)}
          className="px-2.5 py-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          Next →
        </button>
      </div>
    </div>
  );
}

// ---- Page ------------------------------------------------------------------

export function CustomerList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [search, setSearch]   = useState('');
  const [page, setPage]       = useState(1);
  const [modalOpen, setModalOpen] = useState(false);

  const debouncedSearch = useDebounce(search, 300);

  const handleSearch = (value: string) => { setSearch(value); setPage(1); };

  const { data, isLoading, isError } = useQuery<CustomersPage>({
    queryKey: ['customers', { search: debouncedSearch, page }],
    queryFn: () =>
      api.get('/api/customers', {
        params: {
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
          page,
          limit: 20,
        },
      }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
  });

  const createMutation = useMutation({
    mutationFn: (body: CustomerFormData) =>
      api.post('/api/customers', {
        ...body,
        email:      body.email      || undefined,
        city:       body.city       || undefined,
        address:    body.address    || undefined,
        nic_number: body.nic_number || undefined,
        notes:      body.notes      || undefined,
      }).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setModalOpen(false);
    },
  });

  const createError = createMutation.error
    ? ((createMutation.error as { response?: { data?: { error?: { message?: string } } } })
        .response?.data?.error?.message ?? 'Something went wrong')
    : null;

  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Customers</h1>
            {data && <p className="text-sm text-gray-400 mt-0.5">{data.total} total</p>}
          </div>
          <button
            onClick={() => { createMutation.reset(); setModalOpen(true); }}
            className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-white
              bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add customer
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="search" value={search} onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search by name or phone…"
            className="w-full max-w-sm rounded-lg border border-gray-200 pl-9 pr-4 py-2 text-sm
              text-gray-900 outline-none placeholder:text-gray-400
              focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
          />
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-100">
                {['Name', 'Phone', 'Email', 'Vehicles', 'Last visit'].map((h) => (
                  <th key={h} className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading && Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}

              {isError && (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-sm text-red-500">
                    Failed to load customers. Please try again.
                  </td>
                </tr>
              )}

              {!isLoading && data?.customers.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => navigate(`/customers/${c.id}`)}
                  className="group hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${avatarColour(c.name)}`}>
                        {initials(c.name)}
                      </div>
                      <p className="text-sm font-medium text-gray-900 group-hover:text-blue-700 transition-colors">
                        {c.name}
                      </p>
                    </div>
                  </td>
                  <td className="px-6 py-3.5 text-sm text-gray-600">{c.phone}</td>
                  <td className="px-6 py-3.5 text-sm text-gray-500">{c.email ?? '—'}</td>
                  <td className="px-6 py-3.5">
                    <span className="inline-flex items-center gap-1 text-sm text-gray-600">
                      <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0M13 17V7a1 1 0 00-1-1H6l-2 4v6" />
                      </svg>
                      {c.vehicle_count}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 text-sm text-gray-500">{formatDate(c.last_visit)}</td>
                </tr>
              ))}

              {!isLoading && !isError && data?.customers.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-14 text-center">
                    <p className="text-sm font-medium text-gray-500">
                      {search ? `No customers match "${search}"` : 'No customers yet'}
                    </p>
                    {!search && (
                      <button
                        onClick={() => setModalOpen(true)}
                        className="mt-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
                      >
                        Add your first customer →
                      </button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {data && (
            <Pagination page={data.page} total={data.total} limit={data.limit} onChange={setPage} />
          )}
        </div>
      </div>

      <CustomerForm
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="New customer"
        onSubmit={(d) => createMutation.mutate(d)}
        isPending={createMutation.isPending}
        error={createError}
      />
    </AppLayout>
  );
}
