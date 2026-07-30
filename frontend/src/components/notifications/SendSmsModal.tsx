import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { useDebounce } from '../../hooks/useDebounce';
import api from '../../lib/api';
import type { CustomersPage } from '../../types';

const schema = z.object({
  phone:   z.string().min(7, 'Enter a valid phone number').max(20),
  message: z.string().min(1, 'Message is required').max(640, 'Message is too long'),
});

type FormData = z.infer<typeof schema>;

export interface SmsSendPayload {
  phone: string;
  message: string;
  customerId?: string;
  recipientName?: string;
}

interface FixedCustomer {
  id: string;
  name: string;
  phone: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: SmsSendPayload) => void;
  isPending: boolean;
  error?: string | null;
  /** When set, the recipient is fixed to this customer (e.g. opened from a customer page). */
  customer?: FixedCustomer;
}

interface PickedCustomer {
  id: string;
  name: string;
  phone: string;
}

function CustomerPicker({
  onPick,
}: {
  onPick: (c: PickedCustomer) => void;
}) {
  const [search, setSearch] = useState('');
  const [focused, setFocused] = useState(false);
  const debounced = useDebounce(search, 300);

  const { data, isFetching } = useQuery<CustomersPage>({
    queryKey: ['customers', 'sms-picker', debounced],
    queryFn: () =>
      api.get('/api/customers', { params: { search: debounced, page: 1, limit: 8 } })
        .then((r) => r.data.data),
    enabled: debounced.length > 0,
  });

  const showDropdown = focused && debounced.length > 0;

  return (
    <div className="relative">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder="Search by name or phone…"
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none transition
          placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      />
      {showDropdown && (
        <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg
          max-h-56 overflow-y-auto">
          {isFetching ? (
            <p className="px-3 py-2.5 text-sm text-gray-400">Searching…</p>
          ) : data && data.customers.length > 0 ? (
            data.customers.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onPick({ id: c.id, name: c.name, phone: c.phone })}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors"
              >
                <span className="font-medium text-gray-900">{c.name}</span>
                <span className="text-gray-400 ml-2">{c.phone}</span>
              </button>
            ))
          ) : (
            <p className="px-3 py-2.5 text-sm text-gray-400">No customers found</p>
          )}
        </div>
      )}
    </div>
  );
}

export function SendSmsModal({ open, onClose, onSubmit, isPending, error, customer }: Props) {
  const [picked, setPicked] = useState<PickedCustomer | null>(null);

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    if (!open) return;
    setPicked(null);
    reset({ phone: customer?.phone ?? '', message: '' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customer?.id]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const linkedCustomer = customer ?? picked;

  const submit = (data: FormData) => {
    onSubmit({
      phone:         data.phone,
      message:       data.message,
      customerId:    linkedCustomer?.id,
      recipientName: linkedCustomer?.name,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden />

      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">
            {customer ? `Send SMS to ${customer.name}` : 'Send a quick SMS'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit(submit)} noValidate>
          <div className="px-6 py-5 space-y-4">
            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">
                {error}
              </div>
            )}

            {!customer && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Recipient</label>
                {picked ? (
                  <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 bg-gray-50">
                    <span className="text-sm">
                      <span className="font-medium text-gray-900">{picked.name}</span>
                      <span className="text-gray-400 ml-2">{picked.phone}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setPicked(null)}
                      className="text-xs font-medium text-gray-500 hover:text-gray-800"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <>
                    <CustomerPicker
                      onPick={(c) => { setPicked(c); setValue('phone', c.phone); }}
                    />
                    <p className="mt-1.5 text-xs text-gray-400">
                      Or leave unselected and enter a phone number below to message anyone else.
                    </p>
                  </>
                )}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Phone number *</label>
              <input
                {...register('phone')}
                type="tel"
                disabled={!!customer}
                placeholder="077 123 4567"
                className={`w-full rounded-lg border px-3 py-2 text-sm text-gray-900 outline-none transition
                  placeholder:text-gray-400 focus:ring-2 disabled:bg-gray-50 disabled:text-gray-500
                  ${errors.phone
                    ? 'border-red-400 focus:border-red-400 focus:ring-red-100'
                    : 'border-gray-200 focus:border-blue-500 focus:ring-blue-100'}`}
              />
              {errors.phone && <p className="mt-1 text-xs text-red-500">{errors.phone.message}</p>}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Message *</label>
              <textarea
                {...register('message')}
                rows={4}
                placeholder="Type your message…"
                className={`w-full rounded-lg border px-3 py-2 text-sm text-gray-900 outline-none transition
                  placeholder:text-gray-400 focus:ring-2 resize-none
                  ${errors.message
                    ? 'border-red-400 focus:border-red-400 focus:ring-red-100'
                    : 'border-gray-200 focus:border-blue-500 focus:ring-blue-100'}`}
              />
              {errors.message && <p className="mt-1 text-xs text-red-500">{errors.message.message}</p>}
            </div>
          </div>

          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
            <button
              type="button" onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit" disabled={isPending}
              className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg
                hover:bg-blue-700 active:bg-blue-800
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {isPending ? 'Sending…' : 'Send SMS'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
