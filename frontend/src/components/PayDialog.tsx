import { useState } from 'react';
import type { PaymentMethod } from '../types';

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash:          'Cash',
  card:          'Card',
  bank_transfer: 'Bank Transfer',
  cheque:        'Cheque',
  other:         'Other',
};

export const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'card', 'bank_transfer', 'cheque', 'other'];

const REFERENCE_PLACEHOLDER: Partial<Record<PaymentMethod, string>> = {
  cheque:        'Cheque number',
  bank_transfer: 'Transaction / reference number',
  card:          'Card last 4 digits or receipt no.',
  other:         'Reference',
};

export function PayDialog({
  title = 'Mark as Paid',
  onConfirm,
  onCancel,
  isPending,
}: {
  title?: string;
  onConfirm: (method: PaymentMethod, reference: string) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');

  const refPlaceholder = REFERENCE_PLACEHOLDER[method];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} aria-hidden />
      <div className="relative bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
        <h3 className="text-base font-semibold text-gray-900 mb-4">{title}</h3>

        <div className="space-y-2 mb-4">
          {PAYMENT_METHODS.map((m) => (
            <label key={m}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                method === m
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <input
                type="radio"
                name="payment_method"
                value={m}
                checked={method === m}
                onChange={() => { setMethod(m); setReference(''); }}
                className="accent-blue-600"
              />
              <span className="text-sm font-medium text-gray-700">{PAYMENT_LABELS[m]}</span>
            </label>
          ))}
        </div>

        {refPlaceholder && (
          <div className="mb-5">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Reference <span className="text-gray-400">(optional)</span>
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={refPlaceholder}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(method, reference)}
            disabled={isPending}
            className="px-4 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg
              hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? 'Saving…' : 'Confirm Payment'}
          </button>
        </div>
      </div>
    </div>
  );
}
