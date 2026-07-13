import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { ServiceItem } from '../../types';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const serviceSchema = z.object({
  name:        z.string().min(1, 'Name is required'),
  description: z.string().optional().or(z.literal('')),
  category:    z.string().optional().or(z.literal('')),
  price:       z.preprocess((v) => (v === '' || v == null ? 0 : Number(v)), z.number().nonnegative()),
  active:      z.boolean(),
});

export type ServiceFormData = z.infer<typeof serviceSchema>;

export function itemToFormData(item: ServiceItem): ServiceFormData {
  return {
    name:        item.name,
    description: item.description ?? '',
    category:    item.category ?? '',
    price:       item.price,
    active:      item.active,
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORIES = ['Maintenance', 'Repair', 'Diagnostics', 'Inspection', 'Detailing', 'Other'];

const BLANK: ServiceFormData = {
  name: '', description: '', category: '', price: 0, active: true,
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
  defaultValues?: ServiceFormData;
  onSubmit: (data: ServiceFormData) => void;
  isPending: boolean;
  error?: string | null;
}

export function ServiceFormModal({ open, onClose, title, defaultValues, onSubmit, isPending, error }: Props) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<ServiceFormData>({
    resolver: zodResolver(serviceSchema) as any,
    defaultValues: defaultValues ?? BLANK,
  });

  useEffect(() => {
    if (open) reset(defaultValues ?? BLANK);
  }, [open, defaultValues, reset]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">

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

            <Field label="Service name" required error={errors.name?.message}>
              <input {...register('name')} placeholder="e.g. Oil Change" className={inputCls(errors.name?.message)} autoFocus />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Category">
                <select {...register('category')} className={inputCls() + ' bg-white'}>
                  <option value="">— None —</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>

              <Field label="Price (LKR)" error={errors.price?.message}>
                <input type="number" step="0.01" min="0" {...register('price')} className={inputCls(errors.price?.message)} />
              </Field>
            </div>

            <Field label="Description">
              <textarea
                {...register('description')}
                rows={3}
                placeholder="What this service includes…"
                className={inputCls() + ' resize-none'}
              />
            </Field>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" {...register('active')} className="rounded border-gray-300" />
              Active (selectable in work orders)
            </label>

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
