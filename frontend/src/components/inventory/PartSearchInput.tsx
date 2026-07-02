import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDebounce } from '../../hooks/useDebounce';
import api from '../../lib/api';
import type { InventoryItem } from '../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatLKR(n: number) {
  return `LKR ${Math.round(n).toLocaleString('en-US')}`;
}

function stockLabel(item: InventoryItem): { text: string; cls: string; disabled: boolean } {
  if (item.quantity <= 0) {
    return { text: 'Out of stock', cls: 'text-red-500 font-medium', disabled: true };
  }
  if (item.reorder_threshold > 0 && item.quantity <= item.reorder_threshold) {
    return {
      text: `${item.quantity} ${item.unit} · Low stock`,
      cls: 'text-amber-600 font-medium',
      disabled: false,
    };
  }
  return { text: `${item.quantity} ${item.unit}`, cls: 'text-gray-400', disabled: false };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface PartSearchInputProps {
  onSelect: (item: InventoryItem | null) => void;
  placeholder?: string;
}

export function PartSearchInput({
  onSelect,
  placeholder = 'Search parts by name or number…',
}: PartSearchInputProps) {
  const [query, setQuery]   = useState('');
  const [open, setOpen]     = useState(false);
  const containerRef        = useRef<HTMLDivElement>(null);
  const inputRef            = useRef<HTMLInputElement>(null);

  const debouncedQuery = useDebounce(query, 300);

  const { data, isFetching } = useQuery<{ items: InventoryItem[] }>({
    queryKey: ['part-search', debouncedQuery],
    queryFn: () =>
      api.get('/api/inventory', { params: { search: debouncedQuery, limit: 10 } })
        .then((r) => r.data.data),
    enabled: debouncedQuery.trim().length >= 1,
    staleTime: 10_000,
  });

  const items = data?.items ?? [];

  // Close on outside click
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  function handleSelect(item: InventoryItem) {
    onSelect(item);
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  }

  function handleCustomItem() {
    onSelect(null);
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  }

  const showDropdown = open && query.trim().length >= 1;

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <svg
          className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" />
        </svg>

        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder={placeholder}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { if (query.trim()) setOpen(true); }}
          className="w-full pl-8 pr-8 py-1.5 text-sm border border-gray-200 rounded-lg
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />

        {/* Loading spinner / clear */}
        <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
          {isFetching ? (
            <svg className="w-3.5 h-3.5 text-gray-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : query ? (
            <button
              type="button"
              onClick={() => { setQuery(''); setOpen(false); }}
              className="text-gray-400 hover:text-gray-700 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      {/* Dropdown */}
      {showDropdown && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-gray-200
          rounded-xl shadow-lg z-50 overflow-hidden max-h-72 overflow-y-auto">

          {/* Results */}
          {items.map((item) => {
            const stock = stockLabel(item);
            return (
              <button
                key={item.id}
                type="button"
                disabled={stock.disabled}
                onClick={() => handleSelect(item)}
                className={`w-full flex items-center justify-between px-3 py-2.5 text-left
                  border-b border-gray-100 last:border-0 transition-colors
                  ${stock.disabled
                    ? 'opacity-50 cursor-not-allowed bg-gray-50'
                    : 'hover:bg-blue-50'
                  }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900 truncate">{item.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {item.part_number && (
                      <span className="text-xs font-mono text-gray-400">{item.part_number}</span>
                    )}
                    <span className={`text-xs ${stock.cls}`}>{stock.text}</span>
                  </div>
                </div>
                <div className="ml-3 flex-shrink-0 text-right">
                  <p className="text-sm font-semibold text-gray-800">
                    {formatLKR(item.selling_price)}
                  </p>
                  {item.category && (
                    <p className="text-xs text-gray-400">{item.category}</p>
                  )}
                </div>
              </button>
            );
          })}

          {/* Empty state (only when debounce has settled) */}
          {!isFetching && debouncedQuery === query && items.length === 0 && (
            <div className="px-3 py-2.5 text-sm text-gray-400 text-center border-b border-gray-100">
              No parts found for "{query}"
            </div>
          )}

          {/* Add as custom item */}
          <button
            type="button"
            onClick={handleCustomItem}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-left
              hover:bg-gray-50 transition-colors"
          >
            <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none"
              viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-sm text-gray-500">
              Add "<span className="font-medium text-gray-700">{query}</span>" as custom line item
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
