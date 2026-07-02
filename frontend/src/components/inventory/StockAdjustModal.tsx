import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import type { InventoryItem } from '../../types';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const schema = z.object({
  quantityChange:  z.coerce.number({ error: 'Enter a quantity change' })
    .refine((v) => v !== 0, 'Cannot be zero'),
  note:            z.string().min(1, 'Note is required'),
  referenceNumber: z.string().optional(),
  // Supplier / delivery fields — only relevant when receiving (positive change)
  supplierName:    z.string().optional(),
  supplierPhone:   z.string().optional(),
  supplierInvoice: z.string().optional(),
  unitCost:        z.coerce.number().nonnegative().optional(),
  batchNote:       z.string().optional(),
});

type FormData = z.infer<typeof schema>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  item: InventoryItem;
  onClose: () => void;
}

export function StockAdjustModal({ item, onClose }: Props) {
  const queryClient = useQueryClient();

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema) as any, // z.coerce input≠output types; runtime is correct
    defaultValues: {
      note: '', referenceNumber: '',
      supplierName: item.supplier_name ?? '',
      supplierPhone: item.supplier_phone ?? '',
      supplierInvoice: '', unitCost: undefined, batchNote: '',
    },
  });

  useEffect(() => {
    reset({
      quantityChange: undefined, note: '', referenceNumber: '',
      supplierName: item.supplier_name ?? '',
      supplierPhone: item.supplier_phone ?? '',
      supplierInvoice: '', unitCost: undefined, batchNote: '',
    });
  }, [item.id, item.supplier_name, item.supplier_phone, reset]);

  const mutation = useMutation({
    mutationFn: (data: FormData) =>
      api.patch(`/api/inventory/${item.id}/adjust`, {
        quantityChange:  data.quantityChange,
        note:            data.note,
        referenceNumber: data.referenceNumber   || undefined,
        supplierName:    data.supplierName      || undefined,
        supplierPhone:   data.supplierPhone     || undefined,
        supplierInvoice: data.supplierInvoice   || undefined,
        unitCost:        data.unitCost,
        batchNote:       data.batchNote         || undefined,
      }).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-low-stock-count'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-stats'] });
      queryClient.invalidateQueries({ queryKey: ['stock-history', item.id] });
      onClose();
    },
  });

  const apiError = mutation.error
    ? ((mutation.error as { response?: { data?: { error?: { message?: string } } } })
        .response?.data?.error?.message ?? 'Adjustment failed')
    : null;

  const qc = watch('quantityChange');
  const change = typeof qc === 'number' && !isNaN(qc) ? qc : null;
  const newQty  = change !== null ? item.quantity + change : null;
  const willGoBelowZero = newQty !== null && newQty < 0;
  const willBeZero      = newQty === 0;

  const inputCls = (err?: string) =>
    `w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2
    focus:ring-blue-500 focus:border-transparent ${err ? 'border-red-300' : 'border-gray-200'}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Adjust Stock</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 rounded transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="px-5 pt-4 pb-5 space-y-4">

          {/* Part info + quantity preview */}
          <div className="rounded-lg bg-gray-50 px-3 py-3">
            <p className="text-sm font-semibold text-gray-900">{item.name}</p>
            {item.part_number && (
              <p className="text-xs font-mono text-gray-400 mt-0.5">{item.part_number}</p>
            )}

            <div className="flex items-start gap-4 mt-2.5">
              {/* Current */}
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Current qty</p>
                <p className={`text-xl font-bold tabular-nums leading-none ${
                  item.low_stock ? 'text-red-600' : 'text-gray-800'
                }`}>
                  {item.quantity}
                  <span className="text-xs font-normal text-gray-400 ml-1">{item.unit}</span>
                </p>
              </div>

              {change !== null && (
                <>
                  <div className="pt-3.5">
                    <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                  {/* New quantity */}
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">New quantity will be</p>
                    <p className={`text-xl font-bold tabular-nums leading-none ${
                      willGoBelowZero ? 'text-red-600' : willBeZero ? 'text-red-500' : 'text-gray-800'
                    }`}>
                      {newQty}
                      <span className="text-xs font-normal text-gray-400 ml-1">{item.unit}</span>
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Warnings */}
            {willGoBelowZero && (
              <p className="mt-2 text-xs text-red-600 font-medium">
                Cannot go below zero — reduce the deduction amount.
              </p>
            )}
            {willBeZero && !willGoBelowZero && (
              <p className="mt-2 text-xs text-red-500">
                This will leave the item completely out of stock.
              </p>
            )}
            {change !== null && !willGoBelowZero && !willBeZero && newQty !== null && newQty <= item.reorder_threshold && item.reorder_threshold > 0 && (
              <p className="mt-2 text-xs text-amber-600">
                New quantity will be at or below the reorder threshold ({item.reorder_threshold}).
              </p>
            )}
          </div>

          {/* Quantity change */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Quantity change <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              {change !== null && (
                <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold select-none ${
                  change > 0 ? 'text-emerald-600' : 'text-red-500'
                }`}>
                  {change > 0 ? '+' : '−'}
                </span>
              )}
              <input
                type="number"
                step="0.01"
                placeholder="e.g. 50 to add, −5 to remove"
                {...register('quantityChange')}
                autoFocus
                className={`${inputCls(errors.quantityChange?.message)} ${change !== null ? 'pl-7' : ''}`}
              />
            </div>
            <p className="text-xs text-gray-400 mt-0.5">Use a negative number to deduct stock</p>
            {errors.quantityChange && (
              <p className="text-xs text-red-500 mt-0.5">{errors.quantityChange.message}</p>
            )}
          </div>

          {/* Note (required) */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Note / reason <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              {...register('note')}
              placeholder="e.g. Received from supplier, Damaged, Stock count correction…"
              className={inputCls(errors.note?.message)}
            />
            {errors.note && (
              <p className="text-xs text-red-500 mt-0.5">{errors.note.message}</p>
            )}
          </div>

          {/* Reference number (optional) */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Reference number <span className="text-gray-300 font-normal">optional</span>
            </label>
            <input
              type="text"
              {...register('referenceNumber')}
              placeholder="e.g. INV-2024-0123 or PO-456"
              className={inputCls()}
            />
            <p className="text-xs text-gray-400 mt-0.5">Supplier invoice or purchase order number</p>
          </div>

          {/* Supplier / delivery fields — shown when receiving stock */}
          {change !== null && change > 0 && (
            <div className="space-y-3 border-t border-gray-100 pt-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Delivery details</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Supplier name</label>
                  <input type="text" {...register('supplierName')}
                    placeholder="e.g. Lanka Parts Ltd" className={inputCls()} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Supplier phone</label>
                  <input type="text" {...register('supplierPhone')}
                    placeholder="e.g. 0112345678" className={inputCls()} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Supplier invoice #</label>
                  <input type="text" {...register('supplierInvoice')}
                    placeholder="e.g. INV-2024-0123" className={inputCls()} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Unit cost (LKR)</label>
                  <input type="number" step="0.01" min="0" {...register('unitCost')}
                    placeholder="Cost per unit" className={inputCls()} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Batch note</label>
                <input type="text" {...register('batchNote')}
                  placeholder="e.g. Expiry date, lot number, condition notes…" className={inputCls()} />
              </div>
            </div>
          )}

          {apiError && (
            <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{apiError}</p>
          )}

          <div className="flex items-center justify-end gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending || willGoBelowZero}
              className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg
                hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {mutation.isPending ? 'Saving…' : 'Apply Adjustment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
