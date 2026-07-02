import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { InventoryItem } from '../../types';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const num = (fallback = 0) =>
  z.preprocess((v) => (v === '' || v == null ? fallback : Number(v)), z.number().nonnegative());

export const inventorySchema = z.object({
  name:              z.string().min(1, 'Name is required'),
  part_number:       z.string().optional().or(z.literal('')),
  category:          z.string().optional().or(z.literal('')),
  unit:              z.string().min(1),
  quantity:          num(0),
  reorder_threshold: num(0),
  cost_price:        num(0),
  selling_price:     num(0),
  supplier_name:     z.string().optional().or(z.literal('')),
  supplier_phone:    z.string().optional().or(z.literal('')),
  location:          z.string().optional().or(z.literal('')),
  notes:             z.string().optional().or(z.literal('')),
});

export type InventoryFormData = z.infer<typeof inventorySchema>;

export function itemToFormData(item: InventoryItem): InventoryFormData {
  return {
    name:              item.name,
    part_number:       item.part_number ?? '',
    category:          item.category ?? '',
    unit:              item.unit,
    quantity:          item.quantity,
    reorder_threshold: item.reorder_threshold,
    cost_price:        item.cost_price,
    selling_price:     item.selling_price,
    supplier_name:     item.supplier_name ?? '',
    supplier_phone:    item.supplier_phone ?? '',
    location:          item.location ?? '',
    notes:             item.notes ?? '',
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORIES = ['Engine', 'Brakes', 'Filters', 'AC Parts', 'Electrical', 'Body', 'Lubricants', 'Tyres', 'Other'];
const UNITS = ['pcs', 'litres', 'metres', 'kg', 'set'];

const BLANK: InventoryFormData = {
  name: '', part_number: '', category: '', unit: 'pcs',
  quantity: 0, reorder_threshold: 0, cost_price: 0, selling_price: 0,
  supplier_name: '', supplier_phone: '', location: '', notes: '',
};

// ---------------------------------------------------------------------------
// Field helper
// ---------------------------------------------------------------------------

function Field({ label, required, error, children }: {
  label: string; required?: boolean; error?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-red-500 mt-0.5">{error}</p>}
    </div>
  );
}

const inputCls = (err?: string) =>
  `w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2
  focus:ring-blue-500 focus:border-transparent ${err ? 'border-red-300' : 'border-gray-200'}`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  defaultValues?: InventoryFormData;
  onSubmit: (data: InventoryFormData) => void;
  isPending: boolean;
  error?: string | null;
}

export function InventoryFormModal({ open, onClose, title, defaultValues, onSubmit, isPending, error }: Props) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<InventoryFormData>({
    resolver: zodResolver(inventorySchema) as any,
    defaultValues: defaultValues ?? BLANK,
  });

  useEffect(() => {
    if (open) reset(defaultValues ?? BLANK);
  }, [open, defaultValues, reset]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 rounded transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
          <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">

            {/* Basic info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Field label="Part name" required error={errors.name?.message}>
                  <input {...register('name')} placeholder="e.g. Oil Filter" className={inputCls(errors.name?.message)} autoFocus />
                </Field>
              </div>

              <Field label="Part number" error={errors.part_number?.message}>
                <input {...register('part_number')} placeholder="e.g. OF-1234" className={inputCls()} />
              </Field>

              <Field label="Category">
                <select {...register('category')} className={inputCls() + ' bg-white'}>
                  <option value="">— None —</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
            </div>

            {/* Stock */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Stock</p>
              <div className="grid grid-cols-3 gap-4">
                <Field label="Unit" required error={errors.unit?.message}>
                  <select {...register('unit')} className={inputCls() + ' bg-white'}>
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </Field>
                <Field label="Quantity" error={errors.quantity?.message}>
                  <input type="number" step="0.01" min="0" {...register('quantity')} className={inputCls(errors.quantity?.message)} />
                </Field>
                <Field label="Reorder threshold" error={errors.reorder_threshold?.message}>
                  <input type="number" step="0.01" min="0" {...register('reorder_threshold')} className={inputCls()} />
                </Field>
              </div>
            </div>

            {/* Pricing */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Pricing (LKR)</p>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Cost price" error={errors.cost_price?.message}>
                  <input type="number" step="0.01" min="0" {...register('cost_price')} className={inputCls()} />
                </Field>
                <Field label="Selling price" error={errors.selling_price?.message}>
                  <input type="number" step="0.01" min="0" {...register('selling_price')} className={inputCls()} />
                </Field>
              </div>
            </div>

            {/* Supplier */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Supplier</p>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Supplier name">
                  <input {...register('supplier_name')} placeholder="e.g. Lanka Parts Ltd" className={inputCls()} />
                </Field>
                <Field label="Supplier phone">
                  <input {...register('supplier_phone')} placeholder="e.g. 0112345678" className={inputCls()} />
                </Field>
              </div>
            </div>

            {/* Location & notes */}
            <div className="grid grid-cols-2 gap-4">
              <Field label="Storage location">
                <input {...register('location')} placeholder="e.g. Shelf A3" className={inputCls()} />
              </Field>
              <div />
            </div>

            <Field label="Notes">
              <textarea
                {...register('notes')}
                rows={2}
                placeholder="Any additional notes…"
                className={inputCls() + ' resize-none'}
              />
            </Field>

            {error && (
              <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 pb-5 pt-3 border-t border-gray-100 flex-shrink-0">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={isPending}
              className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg
                hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors">
              {isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
