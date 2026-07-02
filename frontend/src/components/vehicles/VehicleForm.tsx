import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { Vehicle } from '../../types';

const FUEL_TYPES = ['petrol', 'diesel', 'hybrid', 'electric', 'lpg', 'other'] as const;
const CURRENT_YEAR = new Date().getFullYear();

// z.preprocess lets HTML string values ("", "2019") coerce cleanly to number | undefined
const optionalInt = (min?: number, max?: number) =>
  z.preprocess(
    (v) => (v === '' || v == null ? undefined : Number(v)),
    min !== undefined && max !== undefined
      ? z.number().int().min(min).max(max).optional()
      : z.number().int().nonnegative().optional(),
  );

const schema = z.object({
  plate_number:    z.string().min(1, 'Required').transform((v) => v.toUpperCase()),
  make:            z.string().min(1, 'Required'),
  model:           z.string().min(1, 'Required'),
  year:            optionalInt(1886, CURRENT_YEAR + 1),
  color:           z.string().optional(),
  fuel_type:       z.preprocess((v) => v === '' ? undefined : v, z.enum(FUEL_TYPES).optional()),
  engine_capacity: z.string().optional(),
  engine_number:   z.string().optional(),
  transmission:    z.preprocess((v) => v === '' ? undefined : v, z.enum(['manual', 'auto']).optional()),
  mileage:         optionalInt(),
  vin:             z.string().optional(),
  ac_system:       z.string().optional(),
  notes:           z.string().optional(),
});

export type VehicleFormData = z.infer<typeof schema>;

interface Props {
  open:          boolean;
  onClose:       () => void;
  title:         string;
  defaultValues?: Partial<VehicleFormData>;
  onSubmit:      (data: VehicleFormData) => void;
  isPending:     boolean;
  error?:        string | null;
}

// ---- Primitives ------------------------------------------------------------

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

function Input({ hasError, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { hasError?: boolean }) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border px-3 py-2 text-sm text-gray-900 outline-none transition
        placeholder:text-gray-400 focus:ring-2
        ${hasError
          ? 'border-red-400 focus:border-red-400 focus:ring-red-100'
          : 'border-gray-200 focus:border-blue-500 focus:ring-blue-100'
        } ${props.className ?? ''}`}
    />
  );
}

function Select({
  hasError, children, ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { hasError?: boolean }) {
  return (
    <select
      {...props}
      className={`w-full rounded-lg border px-3 py-2 text-sm text-gray-900 outline-none transition bg-white
        focus:ring-2
        ${hasError
          ? 'border-red-400 focus:border-red-400 focus:ring-red-100'
          : 'border-gray-200 focus:border-blue-500 focus:ring-blue-100'
        }`}
    >
      {children}
    </select>
  );
}

// ---- Component -------------------------------------------------------------

export function VehicleForm({ open, onClose, title, defaultValues, onSubmit, isPending, error }: Props) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<VehicleFormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema) as any,
    defaultValues,
  });

  // Sync defaultValues when the modal opens (important for edit mode)
  useEffect(() => {
    if (open) reset(defaultValues ?? {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden />

      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="px-6 py-5 space-y-4 max-h-[72vh] overflow-y-auto">
            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">
                {error}
              </div>
            )}

            {/* Plate number — uppercase visually via CSS class, uppercase in value via Zod transform */}
            <Field label="Plate number *" error={errors.plate_number?.message}>
              <Input
                {...register('plate_number')}
                hasError={!!errors.plate_number}
                placeholder="CAR-1234"
                className="uppercase tracking-wider font-mono"
                autoFocus
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Make *" error={errors.make?.message}>
                <Input {...register('make')} hasError={!!errors.make} placeholder="Toyota" />
              </Field>
              <Field label="Model *" error={errors.model?.message}>
                <Input {...register('model')} hasError={!!errors.model} placeholder="Aqua" />
              </Field>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <Field label="Year" error={errors.year?.message}>
                <Input {...register('year')} hasError={!!errors.year}
                  type="number" placeholder={String(CURRENT_YEAR)} min={1886} max={CURRENT_YEAR + 1} />
              </Field>
              <Field label="Color" error={errors.color?.message}>
                <Input {...register('color')} hasError={!!errors.color} placeholder="White" />
              </Field>
              <Field label="Engine" error={errors.engine_capacity?.message}>
                <Input {...register('engine_capacity')} hasError={!!errors.engine_capacity} placeholder="1500cc" />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Fuel type" error={errors.fuel_type?.message}>
                <Select {...register('fuel_type')} hasError={!!errors.fuel_type}>
                  <option value="">— Select —</option>
                  {FUEL_TYPES.map((f) => (
                    <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Transmission" error={errors.transmission?.message}>
                <Select {...register('transmission')} hasError={!!errors.transmission}>
                  <option value="">— Select —</option>
                  <option value="auto">Automatic</option>
                  <option value="manual">Manual</option>
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Mileage / Odometer (km)" error={errors.mileage?.message}>
                <Input {...register('mileage')} hasError={!!errors.mileage}
                  type="number" placeholder="45000" min={0} />
              </Field>
              <Field label="VIN / Chassis number" error={errors.vin?.message}>
                <Input {...register('vin')} hasError={!!errors.vin}
                  placeholder="JH4DB1161NS000565" className="font-mono text-xs" />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Engine number" error={errors.engine_number?.message}>
                <Input {...register('engine_number')} hasError={!!errors.engine_number}
                  placeholder="1NZ-FE-1234567" className="font-mono text-xs" />
              </Field>
              <Field label="A/C system type" error={errors.ac_system?.message}>
                <Input {...register('ac_system')} hasError={!!errors.ac_system}
                  placeholder="R-134a / R-1234yf" />
              </Field>
            </div>

            <Field label="Notes" error={errors.notes?.message}>
              <textarea
                {...register('notes')}
                rows={2}
                placeholder="Any notes about this vehicle…"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none
                  transition placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 resize-none"
              />
            </Field>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={isPending}
              className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg
                hover:bg-blue-700 active:bg-blue-800
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                disabled:opacity-60 disabled:cursor-not-allowed transition-colors">
              {isPending ? 'Saving…' : 'Save vehicle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Helper: convert a Vehicle record → VehicleFormData for edit pre-fill
export function vehicleToFormData(v: Vehicle): Partial<VehicleFormData> {
  return {
    plate_number:    v.plate_number,
    make:            v.make,
    model:           v.model,
    year:            v.year              ?? undefined,
    color:           v.color             ?? '',
    fuel_type:       (v.fuel_type as typeof FUEL_TYPES[number]) ?? undefined,
    engine_capacity: v.engine_capacity   ?? '',
    engine_number:   v.engine_number     ?? '',
    transmission:    (v.transmission as 'manual' | 'auto') ?? undefined,
    mileage:         v.mileage           ?? undefined,
    vin:             v.vin               ?? '',
    ac_system:       v.ac_system         ?? '',
    notes:           v.notes             ?? '',
  };
}
