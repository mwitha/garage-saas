import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';
import type { InventoryItem } from '../../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InventorySearchProps {
  /** Called when the user selects an item from the dropdown */
  onSelect: (item: InventoryItem) => void;
  /** Called when the user clears the selection */
  onClear?: () => void;
  /** Pre-selected item (for edit mode) */
  value?: InventoryItem | null;
  /** Placeholder text */
  placeholder?: string;
  /** Extra CSS classes on the wrapper */
  className?: string;
  /** Input size variant */
  size?: 'sm' | 'md';
  /** Disable interaction */
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatLKR(n: number) {
  return `LKR ${Math.round(n).toLocaleString('en-US')}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InventorySearch({
  onSelect,
  onClear,
  value,
  placeholder = 'Search parts by name or number…',
  className = '',
  size = 'md',
  disabled = false,
}: InventorySearchProps) {
  const [query, setQuery]               = useState(value?.name ?? '');
  const [open, setOpen]                 = useState(false);
  const [selected, setSelected]         = useState<InventoryItem | null>(value ?? null);
  const containerRef                    = useRef<HTMLDivElement>(null);
  const inputRef                        = useRef<HTMLInputElement>(null);

  // Keep internal state in sync when the controlled `value` prop changes
  useEffect(() => {
    setSelected(value ?? null);
    setQuery(value?.name ?? '');
  }, [value]);

  const { data, isFetching } = useQuery<{ items: InventoryItem[] }>({
    queryKey: ['inventory-search', query],
    queryFn: () =>
      api.get('/api/inventory', { params: { search: query, limit: 12 } }).then((r) => r.data.data),
    enabled: open && query.length >= 1,
    staleTime: 10_000,
  });

  const items = data?.items ?? [];

  // Close dropdown on outside click
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const handleSelect = useCallback((item: InventoryItem) => {
    setSelected(item);
    setQuery(item.name);
    setOpen(false);
    onSelect(item);
  }, [onSelect]);

  function handleClear() {
    setSelected(null);
    setQuery('');
    setOpen(false);
    onClear?.();
    inputRef.current?.focus();
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setQuery(v);
    setOpen(true);
    // If user starts typing after a selection, clear the selection
    if (selected && v !== selected.name) {
      setSelected(null);
      onClear?.();
    }
  }

  const inputSizeCls = size === 'sm'
    ? 'px-2 py-1 text-xs'
    : 'px-3 py-2 text-sm';

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        {/* Search icon */}
        <svg
          className={`absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400 ${size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" />
        </svg>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={() => { if (!selected) setOpen(true); }}
          placeholder={selected ? selected.name : placeholder}
          disabled={disabled}
          className={`w-full border border-gray-200 rounded-lg
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
            disabled:opacity-50 disabled:cursor-not-allowed
            ${inputSizeCls}
            ${size === 'sm' ? 'pl-6 pr-6' : 'pl-9 pr-8'}`}
        />

        {/* Loading / clear button */}
        {isFetching && (
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
            <svg className="w-3.5 h-3.5 text-gray-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        )}
        {selected && !isFetching && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Dropdown */}
      {open && (query.length >= 1) && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-gray-200
          rounded-xl shadow-lg z-50 overflow-hidden max-h-64 overflow-y-auto">

          {items.length === 0 && !isFetching && (
            <div className="px-4 py-3 text-sm text-gray-400 text-center">
              No parts found for "{query}"
            </div>
          )}

          {items.map((item) => {
            const isLow = item.quantity <= item.reorder_threshold;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item)}
                className="w-full flex items-center justify-between px-3 py-2.5
                  hover:bg-blue-50 text-left transition-colors border-b border-gray-100 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {item.part_number && (
                      <span className="text-xs font-mono text-gray-400">{item.part_number}</span>
                    )}
                    {item.category && (
                      <span className="text-xs text-gray-400">{item.category}</span>
                    )}
                    {item.location && (
                      <span className="text-xs text-gray-400">· {item.location}</span>
                    )}
                  </div>
                </div>

                <div className="ml-3 text-right flex-shrink-0">
                  <p className="text-sm font-semibold text-gray-800">
                    {formatLKR(item.selling_price)}
                  </p>
                  <p className={`text-xs tabular-nums ${isLow ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                    {item.quantity} {item.unit}
                    {isLow && ' ⚠'}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
