import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';

const FUEL_TYPES = ['petrol', 'diesel', 'hybrid', 'electric', 'lpg', 'other'] as const;
const CURRENT_YEAR = new Date().getFullYear();

const schema = z.object({
  plate_number:    z.string().min(1, 'Plate number is required'),
  make:            z.string().min(1, 'Make is required'),
  model:           z.string().min(1, 'Model is required'),
  year:            z.coerce.number().int().min(1886).max(CURRENT_YEAR + 1).optional(),
  color:           z.string().optional(),
  fuel_type:       z.enum(FUEL_TYPES).optional(),
  transmission:    z.enum(['manual', 'auto']).optional(),
  mileage:         z.coerce.number().int().nonnegative().optional(),
  engine_capacity: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

interface Props {
  open:       boolean;
  onClose:    () => void;
  customerId: string;
}

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
        }`}
    />
  );
}

function Select({ hasError, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { hasError?: boolean }) {
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

export function VehicleFormModal({ open, onClose, customerId }: Props) {
  const queryClient = useQueryClient();

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema) as any,
  });

  useEffect(() => { if (open) reset(); }, [open, reset]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const mutation = useMutation({
    mutationFn: (body: FormData) =>
      api.post(`/api/customers/${customerId}/vehicles`, {
        ...body,
        year:            body.year            || undefined,
        color:           body.color           || undefined,
        fuel_type:       body.fuel_type       || undefined,
        transmission:    body.transmission    || undefined,
        mileage:         body.mileage         || undefined,
        engine_capacity: body.engine_capacity || undefined,
      }).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer', customerId] });
      reset();
      onClose();
    },
  });

  if (!open) return null;

  const apiError = mutation.error
    ? ((mutation.error as { response?: { data?: { error?: { message?: string } } } })
        .response?.data?.error?.message ?? 'Something went wrong')
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden />

      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Add Vehicle</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit((d) => mutation.mutate(d))} noValidate>
          <div className="px-6 py-5 space-y-4">
            {apiError && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">
                {apiError}
              </div>
            )}

            <Field label="Plate number *" error={errors.plate_number?.message}>
              <Input {...register('plate_number')} hasError={!!errors.plate_number}
                placeholder="CAR-1234" autoFocus className="uppercase" />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Make *" error={errors.make?.message}>
                <Input {...register('make')} hasError={!!errors.make} placeholder="Toyota" />
              </Field>
              <Field label="Model *" error={errors.model?.message}>
                <Input {...register('model')} hasError={!!errors.model} placeholder="Aqua" />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Year" error={errors.year?.message}>
                <Input {...register('year')} hasError={!!errors.year}
                  placeholder={String(CURRENT_YEAR)} type="number" min={1886} max={CURRENT_YEAR + 1} />
              </Field>
              <Field label="Color" error={errors.color?.message}>
                <Input {...register('color')} hasError={!!errors.color} placeholder="White" />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Fuel type" error={errors.fuel_type?.message}>
                <Select {...register('fuel_type')} hasError={!!errors.fuel_type}>
                  <option value="">Select…</option>
                  {FUEL_TYPES.map((f) => (
                    <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Transmission" error={errors.transmission?.message}>
                <Select {...register('transmission')} hasError={!!errors.transmission}>
                  <option value="">Select…</option>
                  <option value="auto">Automatic</option>
                  <option value="manual">Manual</option>
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Mileage (km)" error={errors.mileage?.message}>
                <Input {...register('mileage')} hasError={!!errors.mileage}
                  placeholder="45000" type="number" min={0} />
              </Field>
              <Field label="Engine capacity" error={errors.engine_capacity?.message}>
                <Input {...register('engine_capacity')} hasError={!!errors.engine_capacity} placeholder="1500cc" />
              </Field>
            </div>
          </div>

          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={mutation.isPending}
              className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg
                hover:bg-blue-700 active:bg-blue-800
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                disabled:opacity-60 disabled:cursor-not-allowed transition-colors">
              {mutation.isPending ? 'Saving…' : 'Add vehicle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
