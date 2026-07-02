import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '../components/AppLayout';
import { CustomerModal } from '../components/CustomerModal';
import { useDebounce } from '../hooks/useDebounce';
import api from '../lib/api';
import type { CustomerListItem, CustomersPage as CustomersPageData } from '../types';

// Deterministic avatar colour from the first character of the name
const AVATAR_COLOURS = [
  'bg-blue-100 text-blue-700',
  'bg-blue-100   text-blue-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100  text-amber-700',
  'bg-rose-100   text-rose-700',
  'bg-sky-100    text-sky-700',
];
function avatarColour(name: string) {
  return AVATAR_COLOURS[name.charCodeAt(0) % AVATAR_COLOURS.length];
}
function initials(name: string) {
  return name.split(' ').slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

// ---- Skeleton row -------------------------------------------------------
function SkeletonRow() {
  return (
    <tr>
      {[40, 28, 20, 12].map((w, i) => (
        <td key={i} className="px-6 py-3.5">
          <div className={`h-3.5 bg-gray-100 rounded animate-pulse w-${w}`} />
        </td>
      ))}
    </tr>
  );
}

// ---- Pagination ---------------------------------------------------------
interface PaginationProps {
  page: number;
  total: number;
  limit: number;
  onChange: (p: number) => void;
}
function Pagination({ page, total, limit, onChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 bg-white text-sm text-gray-500">
      <span>{total} customer{total !== 1 ? 's' : ''}</span>
      <div className="flex items-center gap-1">
        <button
          disabled={page === 1}
          onClick={() => onChange(page - 1)}
          className="px-2.5 py-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          ← Prev
        </button>
        <span className="px-3">
          {page} / {totalPages}
        </span>
        <button
          disabled={page === totalPages}
          onClick={() => onChange(page + 1)}
          className="px-2.5 py-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

// ---- Row ----------------------------------------------------------------
function CustomerRow({ customer }: { customer: CustomerListItem }) {
  return (
    <tr className="group hover:bg-gray-50 transition-colors">
      <td className="px-6 py-3.5">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${avatarColour(customer.name)}`}>
            {initials(customer.name)}
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">{customer.name}</p>
            {customer.email && (
              <p className="text-xs text-gray-400">{customer.email}</p>
            )}
          </div>
        </div>
      </td>
      <td className="px-6 py-3.5 text-sm text-gray-600">{customer.phone}</td>
      <td className="px-6 py-3.5 text-sm text-gray-500">{customer.city ?? '—'}</td>
      <td className="px-6 py-3.5">
        <span className="inline-flex items-center gap-1 text-sm text-gray-600">
          <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0M13 17V7a1 1 0 00-1-1H6l-2 4v6" />
          </svg>
          {customer.vehicle_count}
        </span>
      </td>
    </tr>
  );
}

// ---- Page ---------------------------------------------------------------
export function CustomersPage() {
  const [search, setSearch]     = useState('');
  const [page, setPage]         = useState(1);
  const [modalOpen, setModalOpen] = useState(false);

  const debouncedSearch = useDebounce(search, 300);

  // Reset to page 1 whenever the search term changes
  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const { data, isLoading, isError } = useQuery<CustomersPageData>({
    queryKey: ['customers', { search: debouncedSearch, page }],
    queryFn: () =>
      api
        .get('/api/customers', {
          params: {
            ...(debouncedSearch ? { search: debouncedSearch } : {}),
            page,
            limit: 20,
          },
        })
        .then((r) => r.data.data),
    placeholderData: (prev) => prev, // keep previous data while re-fetching
  });

  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-5xl mx-auto">

        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Customers</h1>
            {data && (
              <p className="text-sm text-gray-400 mt-0.5">{data.total} total</p>
            )}
          </div>
          <button
            onClick={() => setModalOpen(true)}
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
            type="search"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search by name or phone…"
            className="w-full max-w-sm rounded-lg border border-gray-200 pl-9 pr-4 py-2 text-sm
              text-gray-900 outline-none placeholder:text-gray-400
              focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
          />
        </div>

        {/* Table card */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-100">
                {['Name', 'Phone', 'City', 'Vehicles'].map((h) => (
                  <th key={h} className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">

              {/* Loading skeletons */}
              {isLoading && Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}

              {/* Error */}
              {isError && (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-sm text-red-500">
                    Failed to load customers. Please try again.
                  </td>
                </tr>
              )}

              {/* Rows */}
              {!isLoading && data?.customers.map((c) => (
                <CustomerRow key={c.id} customer={c} />
              ))}

              {/* Empty state */}
              {!isLoading && !isError && data?.customers.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-14 text-center">
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

          {/* Pagination */}
          {data && (
            <Pagination
              page={data.page}
              total={data.total}
              limit={data.limit}
              onChange={setPage}
            />
          )}
        </div>
      </div>

      <CustomerModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </AppLayout>
  );
}
