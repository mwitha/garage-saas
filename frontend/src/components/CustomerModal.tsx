import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

const schema = z.object({
  name:       z.string().min(1, 'Name is required'),
  phone:      z.string().min(1, 'Phone number is required'),
  email:      z.string().optional().refine(
    (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    'Enter a valid email address',
  ),
  city:       z.string().optional(),
  address:    z.string().optional(),
  nic_number: z.string().optional(),
  notes:      z.string().optional(),
});

type FormData = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onClose: () => void;
}

function Field({
  label, error, children,
}: { label: string; error?: string; children: React.ReactNode }) {
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

export function CustomerModal({ open, onClose }: Props) {
  const queryClient = useQueryClient();

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const mutation = useMutation({
    mutationFn: (body: FormData) =>
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
      reset();
      onClose();
    },
  });

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Reset form and clear mutation state when modal opens
  useEffect(() => {
    if (open) { reset(); mutation.reset(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const apiError = mutation.error
    ? ((mutation.error as { response?: { data?: { error?: { message?: string } } } })
        .response?.data?.error?.message ?? 'Something went wrong')
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Card */}
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">New customer</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit((d) => mutation.mutate(d))} noValidate>
          <div className="px-6 py-5 space-y-4">

            {apiError && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">
                {apiError}
              </div>
            )}

            <Field label="Full name *" error={errors.name?.message}>
              <Input {...register('name')} hasError={!!errors.name} placeholder="Kamal Perera" autoFocus />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Phone *" error={errors.phone?.message}>
                <Input {...register('phone')} hasError={!!errors.phone} placeholder="077 123 4567" type="tel" />
              </Field>
              <Field label="Email" error={errors.email?.message}>
                <Input {...register('email')} hasError={!!errors.email} placeholder="kamal@email.lk" type="email" />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="City" error={errors.city?.message}>
                <Input {...register('city')} hasError={!!errors.city} placeholder="Colombo" />
              </Field>
              <Field label="NIC number" error={errors.nic_number?.message}>
                <Input {...register('nic_number')} hasError={!!errors.nic_number} placeholder="901234567V" />
              </Field>
            </div>

            <Field label="Notes" error={errors.notes?.message}>
              <textarea
                {...register('notes')}
                rows={2}
                placeholder="Any additional notes…"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none transition
                  placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 resize-none"
              />
            </Field>

          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg
                hover:bg-blue-700 active:bg-blue-800
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {mutation.isPending ? 'Saving…' : 'Add customer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
