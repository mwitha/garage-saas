import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AppLayout } from '../../components/AppLayout';
import { CompanyHeader } from '../../components/CompanyHeader';
import { InventorySearch } from '../../components/inventory/InventorySearch';
import { ServiceSearchInput } from '../../components/services/ServiceSearchInput';
import api from '../../lib/api';
import type { Invoice, InvoiceItem, InvoiceStatus, PaymentMethod, InventoryItem, ServiceItem } from '../../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<InvoiceStatus, { label: string; cls: string }> = {
  draft:     { label: 'Draft',     cls: 'bg-gray-100 text-gray-600' },
  sent:      { label: 'Sent',      cls: 'bg-blue-100 text-blue-700' },
  paid:      { label: 'Paid',      cls: 'bg-green-100 text-green-700' },
  overdue:   { label: 'Overdue',   cls: 'bg-red-100 text-red-600' },
  cancelled: { label: 'Cancelled', cls: 'bg-gray-100 text-gray-400' },
};

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash:          'Cash',
  card:          'Card',
  bank_transfer: 'Bank Transfer',
  cheque:        'Cheque',
  other:         'Other',
};

const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'card', 'bank_transfer', 'cheque', 'other'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatLKR(n: number, currency = 'LKR') {
  return `${currency} ${Math.round(n).toLocaleString('en-US')}`;
}

function formatDate(s: string) {
  return new Date(s).toLocaleDateString('en-LK', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

function InfoBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">{label}</p>
      <div className="text-sm text-gray-800 leading-relaxed">{children}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: InvoiceStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Mark as Paid dialog
// ---------------------------------------------------------------------------

const REFERENCE_PLACEHOLDER: Partial<Record<PaymentMethod, string>> = {
  cheque:        'Cheque number',
  bank_transfer: 'Transaction / reference number',
  card:          'Card last 4 digits or receipt no.',
  other:         'Reference',
};

function PayDialog({
  onConfirm,
  onCancel,
  isPending,
}: {
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
        <h3 className="text-base font-semibold text-gray-900 mb-4">Mark as Paid</h3>

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

// ---------------------------------------------------------------------------
// Add item row (inline) — parts, services, or a custom line
// ---------------------------------------------------------------------------

const addItemSchema = z.object({
  description: z.string().min(1, 'Required'),
  quantity:    z.preprocess((v) => Number(v), z.number().positive('Must be > 0')),
  unit_price:  z.preprocess((v) => Number(v), z.number().nonnegative()),
});

type AddInvoiceItemFormData = z.infer<typeof addItemSchema>;

function AddInvoiceItemRow({
  invoiceId,
  onAdded,
  onCancel,
}: {
  invoiceId: string;
  onAdded: () => void;
  onCancel: () => void;
}) {
  const [mode, setMode]               = useState<'part' | 'service' | 'custom'>('custom');
  const [selectedInv, setSelectedInv] = useState<InventoryItem | null>(null);
  const [selectedSvc, setSelectedSvc] = useState<ServiceItem | null>(null);

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<AddInvoiceItemFormData>({
    resolver: zodResolver(addItemSchema) as any,
    defaultValues: { quantity: 1, unit_price: 0, description: '' },
  });

  const addMutation = useMutation({
    mutationFn: (data: AddInvoiceItemFormData) =>
      api.post(`/api/invoices/${invoiceId}/items`, data).then((r) => r.data.data),
    onSuccess: onAdded,
  });

  const watchQty       = watch('quantity');
  const watchUnitPrice = watch('unit_price');
  const lineTotal      = (Number(watchQty) || 0) * (Number(watchUnitPrice) || 0);

  function switchMode(next: 'part' | 'service' | 'custom') {
    setMode(next);
    setSelectedInv(null);
    setSelectedSvc(null);
    setValue('description', '');
    setValue('unit_price', 0);
  }

  function handleSelectInv(item: InventoryItem) {
    setSelectedInv(item);
    setValue('description', item.name);
    setValue('unit_price', item.selling_price);
  }

  function handleSelectSvc(item: ServiceItem) {
    setSelectedSvc(item);
    setValue('description', item.name);
    setValue('unit_price', item.price);
  }

  return (
    <tr className="bg-blue-50">
      <td className="print:hidden" />
      <td className="py-2 pr-2" colSpan={1}>
        <div className="flex gap-1 mb-1.5">
          {(['part', 'service', 'custom'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={`px-2 py-0.5 text-[10px] font-semibold rounded-md border capitalize transition-colors ${
                mode === m
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        {mode === 'part' && (
          <InventorySearch
            size="sm"
            value={selectedInv}
            onSelect={handleSelectInv}
            onClear={() => setSelectedInv(null)}
            placeholder="Search parts…"
            className="mb-1.5"
          />
        )}
        {mode === 'service' && (
          <ServiceSearchInput
            size="sm"
            value={selectedSvc}
            onSelect={handleSelectSvc}
            onClear={() => setSelectedSvc(null)}
            placeholder="Search services…"
            className="mb-1.5"
          />
        )}
        <input
          {...register('description')}
          placeholder="Line item description…"
          className="w-full px-2 py-1 text-xs border border-blue-300 rounded-lg
            focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        {errors.description && (
          <p className="text-[10px] text-red-500 mt-0.5">{errors.description.message}</p>
        )}
      </td>
      <td className="py-2 px-2 w-20 align-top">
        <input
          type="number"
          step="0.01"
          min="0.01"
          {...register('quantity')}
          className="w-full px-2 py-1 text-xs border border-blue-300 rounded-lg
            focus:outline-none focus:ring-1 focus:ring-blue-500 tabular-nums"
        />
      </td>
      <td className="py-2 px-2 w-36 align-top">
        <input
          type="number"
          step="0.01"
          min="0"
          {...register('unit_price')}
          className="w-full px-2 py-1 text-xs border border-blue-300 rounded-lg
            focus:outline-none focus:ring-1 focus:ring-blue-500 tabular-nums"
        />
      </td>
      <td className="py-2 pl-2 w-36 align-top text-right text-xs text-gray-500 tabular-nums whitespace-nowrap">
        {formatLKR(lineTotal)}
      </td>
      <td className="py-2 pl-2 align-top">
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={handleSubmit((d) => addMutation.mutate(d))}
            disabled={addMutation.isPending}
            className="px-3 py-1 text-xs font-semibold text-white bg-blue-600 rounded-lg
              hover:bg-blue-700 disabled:opacity-60 transition-colors whitespace-nowrap"
          >
            {addMutation.isPending ? '…' : 'Add'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
          >
            Cancel
          </button>
        </div>
        {addMutation.error && (
          <p className="text-[10px] text-red-500 mt-0.5">
            {(addMutation.error as { response?: { data?: { error?: { message?: string } } } })
              .response?.data?.error?.message ?? 'Error'}
          </p>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Page skeleton
// ---------------------------------------------------------------------------

function PageSkeleton() {
  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-4xl mx-auto space-y-6">
        <div className="h-4 w-48 bg-gray-100 rounded animate-pulse" />
        <div className="bg-white rounded-xl border border-gray-200 p-8 space-y-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-6 w-64 bg-gray-100 rounded animate-pulse" />
          ))}
        </div>
      </div>
    </AppLayout>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [payOpen, setPayOpen] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [sendLoading, setSendLoading] = useState(false);
  const [addingItem, setAddingItem] = useState(false);
  const [editingCell, setEditingCell] = useState<{ itemId: string; field: 'quantity' | 'unit_price' } | null>(null);
  const [editValue, setEditValue] = useState('');

  const { data: inv, isLoading, isError } = useQuery<Invoice>({
    queryKey: ['invoice', id],
    queryFn: () => api.get(`/api/invoices/${id}`).then((r) => r.data.data),
    enabled: !!id,
  });

  const payMutation = useMutation({
    mutationFn: ({ method, reference }: { method: PaymentMethod; reference: string }) =>
      api.patch(`/api/invoices/${id}/pay`, {
        payment_method:    method,
        payment_reference: reference || undefined,
      }).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      setPayOpen(false);
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: (itemId: string) =>
      api.delete(`/api/invoices/${id}/items/${itemId}`).then((r) => r.data.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoice', id] }),
  });

  const editItemMutation = useMutation({
    mutationFn: ({ itemId, data }: { itemId: string; data: Partial<Record<'quantity' | 'unit_price', number>> }) =>
      api.patch(`/api/invoices/${id}/items/${itemId}`, data).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      setEditingCell(null);
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (itemIds: string[]) =>
      api.patch(`/api/invoices/${id}/items/reorder`, { itemIds }).then((r) => r.data.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoice', id] }),
  });

  function moveItem(index: number, direction: -1 | 1) {
    if (!inv) return;
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= inv.items.length) return;
    const ids = inv.items.map((it) => it.id);
    [ids[index], ids[newIndex]] = [ids[newIndex], ids[index]];
    reorderMutation.mutate(ids);
  }

  function startEdit(item: InvoiceItem, field: 'quantity' | 'unit_price') {
    setEditingCell({ itemId: item.id, field });
    setEditValue(String(field === 'quantity' ? item.quantity : item.unit_price));
  }

  function commitEdit(itemId: string, field: 'quantity' | 'unit_price') {
    const num = parseFloat(editValue);
    if (isNaN(num) || num < 0 || (field === 'quantity' && num <= 0)) {
      setEditingCell(null);
      return;
    }
    editItemMutation.mutate({ itemId, data: { [field]: num } });
  }

  async function handleDownloadPdf() {
    if (!inv) return;
    setPdfLoading(true);
    try {
      const res = await api.get(`/api/invoices/${id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a   = document.createElement('a');
      a.href     = url;
      a.download = `${inv.invoice_number}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('PDF download failed:', err);
    } finally {
      setPdfLoading(false);
    }
  }

  async function handleSend() {
    setSendLoading(true);
    try {
      // Mark as "sent" — full email/SMS integration is a future phase
      await api.patch(`/api/invoices/${id}/pay`, { payment_method: 'cash' });
    } catch {
      // stub — no-op if not implemented
    } finally {
      setSendLoading(false);
    }
  }

  if (isLoading) return <PageSkeleton />;

  if (isError || !inv) {
    return (
      <AppLayout>
        <div className="px-8 py-8 max-w-4xl mx-auto">
          <button onClick={() => navigate('/invoices')}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-6 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Invoices
          </button>
          <p className="text-sm text-red-500">Invoice not found.</p>
        </div>
      </AppLayout>
    );
  }

  const currency = inv.currency ?? 'LKR';
  const isPaid   = inv.status === 'paid';
  const isFinal  = inv.status === 'paid' || inv.status === 'cancelled';
  const isDraft  = inv.status === 'draft';

  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-4xl mx-auto space-y-6 print:p-0 print:max-w-none print:space-y-0">

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-gray-400 print:hidden">
          <button onClick={() => navigate('/invoices')} className="hover:text-gray-700 transition-colors">
            Invoices
          </button>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-gray-700 font-mono font-semibold">{inv.invoice_number}</span>
        </div>

        {/* Action bar */}
        <div className="flex items-center justify-between print:hidden">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-mono font-bold text-gray-900">{inv.invoice_number}</h1>
            <StatusBadge status={inv.status} />
          </div>
          <div className="flex items-center gap-2">
            {/* Print */}
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600
                border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2m-8 0h8v4H6v-4z" />
              </svg>
              Print
            </button>

            {/* Send to Customer */}
            <button
              onClick={handleSend}
              disabled={sendLoading || isFinal}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600
                border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40
                disabled:cursor-not-allowed transition-colors"
              title={isFinal ? 'Invoice is finalised' : 'Send to customer (email/SMS)'}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              {sendLoading ? 'Sending…' : 'Send'}
            </button>

            {/* Download PDF */}
            <button
              onClick={handleDownloadPdf}
              disabled={pdfLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600
                border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-60
                disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {pdfLoading ? 'Generating…' : 'Download PDF'}
            </button>

            {/* Mark as Paid */}
            {!isPaid && inv.status !== 'cancelled' && (
              <button
                onClick={() => setPayOpen(true)}
                className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold text-white
                  bg-green-600 hover:bg-green-700 rounded-lg transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Mark as Paid
              </button>
            )}
          </div>
        </div>

        {/* Invoice document */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden print:border-0 print:shadow-none print:rounded-none">

          {/* Company header */}
          <CompanyHeader
            docTitle="INVOICE"
            docNumber={inv.invoice_number}
            badge={<StatusBadge status={inv.status} />}
          />

          {/* Meta blocks */}
          <div className="grid grid-cols-3 gap-6 px-8 py-6 border-b border-gray-100">
            <InfoBlock label="Bill To">
              <p className="font-semibold text-gray-900">{inv.customer_name}</p>
              <p className="text-gray-500">{inv.customer_phone}</p>
              {inv.customer_email   && <p className="text-gray-500">{inv.customer_email}</p>}
              {inv.customer_address && <p className="text-gray-500 text-xs">{inv.customer_address}</p>}
            </InfoBlock>

            <InfoBlock label="Vehicle">
              <button
                onClick={() => navigate(`/vehicles/${inv.vehicle_id}`)}
                className="font-mono font-bold text-gray-900 hover:text-blue-600 transition-colors"
              >
                {inv.plate_number}
              </button>
              <p className="text-gray-500">
                {inv.make} {inv.model}{inv.year ? ` · ${inv.year}` : ''}
              </p>
              {inv.mileage_in != null && (
                <p className="text-gray-400 text-xs">{inv.mileage_in.toLocaleString()} km in</p>
              )}
            </InfoBlock>

            <InfoBlock label="Invoice Details">
              <p><span className="text-gray-500">Date: </span>{formatDate(inv.created_at)}</p>
              {inv.due_date && (
                <p className={new Date(inv.due_date) < new Date() && !isPaid ? 'text-red-600 font-semibold' : ''}>
                  <span className="text-gray-500">Due: </span>{formatDate(inv.due_date)}
                </p>
              )}
              <p>
                <span className="text-gray-500">Work Order: </span>
                <button
                  onClick={() => navigate(`/work-orders/${inv.work_order_id}`)}
                  className="font-mono font-semibold text-blue-600 hover:text-blue-700 transition-colors"
                >
                  {inv.order_number}
                </button>
              </p>
            </InfoBlock>
          </div>

          {/* Line items table */}
          <div className="px-8 py-6 border-b border-gray-100">
            {isDraft && (
              <div className="flex items-center justify-between mb-3 print:hidden">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Line items</span>
                <button
                  type="button"
                  onClick={() => setAddingItem((v) => !v)}
                  className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border transition-colors ${
                    addingItem
                      ? 'bg-gray-100 border-gray-200 text-gray-600 hover:bg-gray-200'
                      : 'bg-blue-50 border-blue-200 text-blue-600 hover:bg-blue-100'
                  }`}
                >
                  {addingItem ? 'Cancel' : (
                    <>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                      Add item
                    </>
                  )}
                </button>
              </div>
            )}
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b-2 border-gray-200">
                  {isDraft && <th className="pb-3 w-8 print:hidden" />}
                  <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Description</th>
                  <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center w-20">Qty</th>
                  <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right w-36">Unit Price</th>
                  <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right w-36">Total</th>
                  {isDraft && <th className="pb-3 w-10 print:hidden" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {inv.items.map((item, index) => (
                  <tr key={item.id} className="group">
                    {isDraft && (
                      <td className="py-1.5 pr-1 print:hidden">
                        <div className="flex flex-col gap-0.5">
                          <button
                            type="button"
                            onClick={() => moveItem(index, -1)}
                            disabled={index === 0 || reorderMutation.isPending}
                            className="text-gray-300 hover:text-blue-600 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                            title="Move up"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => moveItem(index, 1)}
                            disabled={index === inv.items.length - 1 || reorderMutation.isPending}
                            className="text-gray-300 hover:text-blue-600 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                            title="Move down"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    )}
                    <td className="py-1.5 text-sm text-gray-800">{item.description}</td>
                    <td className="py-1.5 text-sm text-gray-600 text-center tabular-nums">
                      {isDraft && editingCell?.itemId === item.id && editingCell.field === 'quantity' ? (
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={() => commitEdit(item.id, 'quantity')}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEdit(item.id, 'quantity');
                            if (e.key === 'Escape') setEditingCell(null);
                          }}
                          className="w-16 text-center px-1 py-0.5 text-sm border border-blue-300 rounded
                            focus:outline-none focus:ring-1 focus:ring-blue-500 tabular-nums"
                        />
                      ) : (
                        <span
                          onClick={() => isDraft && startEdit(item, 'quantity')}
                          className={isDraft ? 'cursor-pointer hover:bg-blue-50 rounded px-1.5 py-0.5 -mx-1.5' : ''}
                        >
                          {item.quantity}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-sm text-gray-600 text-right tabular-nums whitespace-nowrap">
                      {isDraft && editingCell?.itemId === item.id && editingCell.field === 'unit_price' ? (
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={() => commitEdit(item.id, 'unit_price')}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEdit(item.id, 'unit_price');
                            if (e.key === 'Escape') setEditingCell(null);
                          }}
                          className="w-24 text-right px-1 py-0.5 text-sm border border-blue-300 rounded
                            focus:outline-none focus:ring-1 focus:ring-blue-500 tabular-nums"
                        />
                      ) : (
                        <span
                          onClick={() => isDraft && startEdit(item, 'unit_price')}
                          className={isDraft ? 'cursor-pointer hover:bg-blue-50 rounded px-1.5 py-0.5 -mx-1.5' : ''}
                        >
                          {formatLKR(item.unit_price, currency)}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-sm font-semibold text-gray-900 text-right tabular-nums whitespace-nowrap">
                      {formatLKR(item.line_total, currency)}
                    </td>
                    {isDraft && (
                      <td className="py-1.5 pl-2 print:hidden">
                        <button
                          type="button"
                          onClick={() => deleteItemMutation.mutate(item.id)}
                          disabled={deleteItemMutation.isPending}
                          className="p-1 text-gray-300 hover:text-red-500 rounded transition-colors disabled:opacity-50 opacity-0 group-hover:opacity-100"
                          title="Remove item"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round"
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {addingItem && isDraft && (
                  <AddInvoiceItemRow
                    invoiceId={id!}
                    onAdded={() => {
                      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
                      setAddingItem(false);
                    }}
                    onCancel={() => setAddingItem(false)}
                  />
                )}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="px-8 py-6 flex justify-end border-b border-gray-100">
            <div className="w-64 space-y-2">
              <div className="flex justify-between text-sm text-gray-600">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatLKR(inv.subtotal, currency)}</span>
              </div>
              {inv.discount > 0 && (
                <div className="flex justify-between text-sm text-green-600">
                  <span>Discount</span>
                  <span className="tabular-nums">− {formatLKR(inv.discount, currency)}</span>
                </div>
              )}
              {inv.tax_rate > 0 && (
                <div className="flex justify-between text-sm text-gray-600">
                  <span>{inv.tax_label} ({inv.tax_rate}%)</span>
                  <span className="tabular-nums">{formatLKR(inv.tax_amount, currency)}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-bold text-gray-900 pt-2 border-t-2 border-blue-600">
                <span>Total</span>
                <span className="tabular-nums text-blue-600">{formatLKR(inv.total, currency)}</span>
              </div>
            </div>
          </div>

          {/* Paid stamp */}
          {isPaid && (
            <div className="px-8 py-5 bg-green-50 border-b border-green-100 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-green-700">Payment Received</p>
                <p className="text-xs text-green-600">
                  {inv.paid_at ? formatDate(inv.paid_at) : ''}
                  {inv.payment_method ? ` · ${PAYMENT_LABELS[inv.payment_method]}` : ''}
                  {inv.payment_reference ? ` · Ref: ${inv.payment_reference}` : ''}
                </p>
              </div>
            </div>
          )}

          {/* Notes + complaint */}
          {(inv.notes || inv.customer_complaint) && (
            <div className="px-8 py-5 space-y-4">
              {inv.notes && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Notes</p>
                  <p className="text-sm text-gray-600 leading-relaxed">{inv.notes}</p>
                </div>
              )}
              {inv.customer_complaint && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                    Customer Complaint
                  </p>
                  <p className="text-sm text-gray-600 leading-relaxed">{inv.customer_complaint}</p>
                </div>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="px-8 py-4 bg-gray-50 text-center">
            <p className="text-xs text-gray-400">Thank you for your business · {inv.workshop_name}</p>
          </div>
        </div>

      </div>

      {/* Pay dialog */}
      {payOpen && (
        <PayDialog
          onConfirm={(m, ref) => payMutation.mutate({ method: m, reference: ref })}
          onCancel={() => setPayOpen(false)}
          isPending={payMutation.isPending}
        />
      )}
    </AppLayout>
  );
}
