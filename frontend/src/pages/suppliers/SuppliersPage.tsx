import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useDebounce } from '../../hooks/useDebounce';
import { AppLayout } from '../../components/AppLayout';
import api from '../../lib/api';
import type { InventoryItem } from '../../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  item_count: number;
  grn_count: number;
}

interface GrnSummary {
  id: string;
  grn_number: string;
  status: 'draft' | 'posted';
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_invoice: string | null;
  received_at: string | null;
  total_cost: number;
  item_count: number;
  created_at: string;
  posted_at: string | null;
}

interface GrnItem {
  id?: string;
  inventory_item_id: string;
  item_name: string;
  part_number: string | null;
  unit: string;
  quantity: number;
  unit_cost: number;
  line_total: number;
}

interface GrnDetail {
  id: string;
  grn_number: string;
  status: 'draft' | 'posted';
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_phone: string | null;
  supplier_invoice: string | null;
  received_at: string | null;
  total_cost: number;
  notes: string | null;
  posted_at: string | null;
  items: GrnItem[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtLKR(n: number) {
  return `LKR ${Math.round(n).toLocaleString('en-US')}`;
}

function fmtDate(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-LK', { day: 'numeric', month: 'short', year: 'numeric' });
}

function apiErr(err: unknown): string {
  return (err as { response?: { data?: { error?: { message?: string } } } })
    ?.response?.data?.error?.message ?? 'Something went wrong';
}

const inputCls = (err?: string) =>
  `w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500
   ${err ? 'border-red-300' : 'border-gray-200'}`;

function FieldWrap({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {children}
      {error && <p className="text-xs text-red-500 mt-0.5">{error}</p>}
    </div>
  );
}

function ModalShell({ title, onClose, wide, children }: {
  title: string; onClose: () => void; wide?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className={`relative bg-white rounded-2xl shadow-xl w-full my-8 ${wide ? 'max-w-3xl' : 'max-w-md'} p-6`}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Supplier add / edit modal
// ---------------------------------------------------------------------------

const supplierSchema = z.object({
  name:    z.string().min(1, 'Name is required'),
  phone:   z.string().optional(),
  email:   z.string().email('Invalid email').optional().or(z.literal('')),
  address: z.string().optional(),
  notes:   z.string().optional(),
});
type SupplierForm = z.infer<typeof supplierSchema>;

function SupplierModal({ supplier, onClose }: { supplier?: Supplier; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!supplier;

  const { register, handleSubmit, formState: { errors, isDirty } } = useForm<SupplierForm>({
    resolver: zodResolver(supplierSchema),
    defaultValues: {
      name: supplier?.name ?? '',
      phone: supplier?.phone ?? '',
      email: supplier?.email ?? '',
      address: supplier?.address ?? '',
      notes: supplier?.notes ?? '',
    },
  });

  const mutation = useMutation({
    mutationFn: (data: SupplierForm) =>
      isEdit
        ? api.patch(`/api/suppliers/${supplier!.id}`, data).then((r) => r.data.data)
        : api.post('/api/suppliers', data).then((r) => r.data.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); onClose(); },
  });

  const toggleMutation = useMutation({
    mutationFn: () =>
      api.patch(`/api/suppliers/${supplier!.id}`, { active: !supplier!.active }).then((r) => r.data.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); onClose(); },
  });

  return (
    <ModalShell title={isEdit ? 'Edit Supplier' : 'Add Supplier'} onClose={onClose}>
      <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-3">
        <FieldWrap label="Supplier name *" error={errors.name?.message}>
          <input {...register('name')} autoFocus className={inputCls(errors.name?.message)} />
        </FieldWrap>
        <div className="grid grid-cols-2 gap-3">
          <FieldWrap label="Phone" error={errors.phone?.message}>
            <input {...register('phone')} placeholder="e.g. 0112345678" className={inputCls()} />
          </FieldWrap>
          <FieldWrap label="Email" error={errors.email?.message}>
            <input {...register('email')} type="email" className={inputCls(errors.email?.message)} />
          </FieldWrap>
        </div>
        <FieldWrap label="Address" error={errors.address?.message}>
          <input {...register('address')} className={inputCls()} />
        </FieldWrap>
        <FieldWrap label="Notes" error={errors.notes?.message}>
          <textarea {...register('notes')} rows={2}
            className={`${inputCls()} resize-none`} />
        </FieldWrap>

        {mutation.isError && (
          <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {apiErr(mutation.error)}
          </p>
        )}

        <div className="flex items-center justify-between pt-1">
          {isEdit ? (
            <button type="button" onClick={() => toggleMutation.mutate()}
              disabled={toggleMutation.isPending}
              className={`text-xs font-medium transition-colors disabled:opacity-60 ${
                supplier!.active ? 'text-red-500 hover:text-red-700' : 'text-emerald-600 hover:text-emerald-700'
              }`}>
              {supplier!.active ? 'Deactivate' : 'Reactivate'}
            </button>
          ) : <span />}
          <div className="flex gap-3">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={mutation.isPending || (isEdit && !isDirty)}
              className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg
                hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {mutation.isPending ? 'Saving…' : isEdit ? 'Save' : 'Add Supplier'}
            </button>
          </div>
        </div>
      </form>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Inventory item search (GRN context — all items selectable regardless of stock)
// ---------------------------------------------------------------------------

function ItemSearchDropdown({ onSelect }: { onSelect: (item: InventoryItem) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen]   = useState(false);
  const containerRef      = useRef<HTMLDivElement>(null);
  const debounced         = useDebounce(query, 300);

  const { data, isFetching } = useQuery<{ items: InventoryItem[] }>({
    queryKey: ['grn-item-search', debounced],
    queryFn: () => api.get('/api/inventory', { params: { search: debounced, limit: 10 } }).then((r) => r.data.data),
    enabled: debounced.trim().length >= 1,
    staleTime: 10_000,
  });

  useEffect(() => {
    function outside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" />
        </svg>
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { if (query.trim()) setOpen(true); }}
          placeholder="Search inventory to add…"
          className="w-full pl-8 pr-8 py-2 text-sm border border-dashed border-blue-300 rounded-lg
            focus:outline-none focus:ring-2 focus:ring-blue-500 bg-blue-50/50 placeholder-blue-300"
        />
        {isFetching && (
          <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 animate-spin"
            fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
      </div>
      {open && query.trim().length >= 1 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200
          rounded-xl shadow-lg z-50 max-h-60 overflow-y-auto">
          {(data?.items ?? []).map((item) => (
            <button key={item.id} type="button"
              onClick={() => { onSelect(item); setQuery(''); setOpen(false); }}
              className="w-full flex items-center justify-between px-3 py-2.5 text-left
                hover:bg-blue-50 border-b border-gray-100 last:border-0 transition-colors">
              <div>
                <p className="text-sm font-medium text-gray-900">{item.name}</p>
                <p className="text-xs text-gray-400">
                  {item.part_number ? `${item.part_number} · ` : ''}{item.unit} · stock: {item.quantity}
                </p>
              </div>
              <span className="text-xs text-gray-500 ml-3">{fmtLKR(item.cost_price)}/unit</span>
            </button>
          ))}
          {!isFetching && debounced === query && (data?.items ?? []).length === 0 && (
            <p className="px-3 py-3 text-sm text-gray-400 text-center">No items found</p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GRN form (create / edit draft)
// ---------------------------------------------------------------------------

interface LineItem {
  inventory_item_id: string;
  item_name: string;
  part_number: string | null;
  unit: string;
  quantity: number;
  unit_cost: number;
}

function GrnForm({ grn, suppliers, onClose, onSaved }: {
  grn?: GrnDetail;
  suppliers: Supplier[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!grn;

  const [supplierId, setSupplierId] = useState<string>(grn?.supplier_id ?? '');
  const [supplierInvoice, setSupplierInvoice] = useState(grn?.supplier_invoice ?? '');
  const [receivedAt, setReceivedAt] = useState(
    grn?.received_at ? grn.received_at.slice(0, 10) : new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState(grn?.notes ?? '');
  const [lines, setLines] = useState<LineItem[]>(
    grn?.items.map((i) => ({
      inventory_item_id: i.inventory_item_id,
      item_name: i.item_name,
      part_number: i.part_number,
      unit: i.unit,
      quantity: i.quantity,
      unit_cost: i.unit_cost,
    })) ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);

  function addItem(item: InventoryItem) {
    const existing = lines.findIndex((l) => l.inventory_item_id === item.id);
    if (existing >= 0) {
      setLines((prev) => prev.map((l, i) =>
        i === existing ? { ...l, quantity: l.quantity + 1 } : l,
      ));
    } else {
      setLines((prev) => [...prev, {
        inventory_item_id: item.id,
        item_name: item.name,
        part_number: item.part_number,
        unit: item.unit,
        quantity: 1,
        unit_cost: item.cost_price,
      }]);
    }
  }

  function removeItem(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, field: 'quantity' | 'unit_cost', value: number) {
    setLines((prev) => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  }

  const totalCost = lines.reduce((s, l) => s + l.quantity * l.unit_cost, 0);

  function buildPayload() {
    return {
      supplier_id: supplierId || null,
      supplier_invoice: supplierInvoice || null,
      received_at: receivedAt,
      notes: notes || null,
      items: lines.map((l) => ({
        inventory_item_id: l.inventory_item_id,
        quantity: l.quantity,
        unit_cost: l.unit_cost,
      })),
    };
  }

  async function handleSave() {
    if (lines.length === 0) { setError('Add at least one item'); return; }
    setError(null);
    setSaving(true);
    try {
      if (isEdit) {
        await api.patch(`/api/grns/${grn!.id}`, buildPayload());
      } else {
        await api.post('/api/grns', buildPayload());
      }
      qc.invalidateQueries({ queryKey: ['grns'] });
      onSaved();
    } catch (err) {
      setError(apiErr(err));
    } finally {
      setSaving(false);
    }
  }

  async function handlePost() {
    if (lines.length === 0) { setError('Add at least one item'); return; }
    setError(null);
    setPosting(true);
    try {
      let targetId = grn?.id;
      if (!targetId) {
        // Save draft first, then post
        const res = await api.post('/api/grns', buildPayload());
        targetId = res.data.data.id;
      } else {
        await api.patch(`/api/grns/${grn!.id}`, buildPayload());
      }
      await api.post(`/api/grns/${targetId}/post`);
      qc.invalidateQueries({ queryKey: ['grns'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      onSaved();
    } catch (err) {
      setError(apiErr(err));
    } finally {
      setPosting(false);
    }
  }

  return (
    <ModalShell title={isEdit ? `Edit GRN ${grn!.grn_number}` : 'New Goods Received Note'} onClose={onClose} wide>
      <div className="space-y-5">

        {/* Header fields */}
        <div className="grid grid-cols-2 gap-4">
          <FieldWrap label="Supplier">
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className={inputCls()}
            >
              <option value="">— Select supplier —</option>
              {suppliers.filter((s) => s.active).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </FieldWrap>
          <FieldWrap label="Supplier Invoice / Delivery Note">
            <input
              value={supplierInvoice}
              onChange={(e) => setSupplierInvoice(e.target.value)}
              placeholder="e.g. INV-2024-001"
              className={inputCls()}
            />
          </FieldWrap>
          <FieldWrap label="Received Date">
            <input
              type="date"
              value={receivedAt}
              onChange={(e) => setReceivedAt(e.target.value)}
              className={inputCls()}
            />
          </FieldWrap>
          <FieldWrap label="Notes">
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes"
              className={inputCls()}
            />
          </FieldWrap>
        </div>

        {/* Line items */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Items</p>

          {lines.length > 0 && (
            <div className="border border-gray-200 rounded-xl overflow-hidden mb-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Item</th>
                    <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider w-24">Qty</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider w-32">Unit Cost</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider w-32">Total</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lines.map((line, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-gray-900">{line.item_name}</p>
                        {line.part_number && (
                          <p className="text-xs font-mono text-gray-400">{line.part_number}</p>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={line.quantity}
                          onChange={(e) => updateLine(idx, 'quantity', parseFloat(e.target.value) || 0)}
                          className="w-full text-center px-2 py-1 text-sm border border-gray-200
                            rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.unit_cost}
                          onChange={(e) => updateLine(idx, 'unit_cost', parseFloat(e.target.value) || 0)}
                          className="w-full text-right px-2 py-1 text-sm border border-gray-200
                            rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-gray-900 tabular-nums">
                        {fmtLKR(line.quantity * line.unit_cost)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button type="button" onClick={() => removeItem(idx)}
                          className="p-1 text-gray-300 hover:text-red-500 transition-colors rounded">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50">
                    <td colSpan={3} className="px-4 py-2.5 text-sm font-semibold text-gray-700 text-right">
                      Total Cost
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold text-gray-900 tabular-nums">
                      {fmtLKR(totalCost)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <ItemSearchDropdown onSelect={addItem} />
        </div>

        {error && (
          <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between pt-1 border-t border-gray-100">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
            Cancel
          </button>
          <div className="flex gap-3">
            <button type="button" onClick={handleSave} disabled={saving || posting}
              className="px-5 py-2 text-sm font-semibold text-gray-700 border border-gray-200 rounded-lg
                hover:bg-gray-50 disabled:opacity-50 transition-colors">
              {saving ? 'Saving…' : 'Save Draft'}
            </button>
            <button type="button" onClick={handlePost} disabled={saving || posting || lines.length === 0}
              className="flex items-center gap-1.5 px-5 py-2 text-sm font-semibold text-white
                bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"
                stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              {posting ? 'Posting…' : 'Post GRN'}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// GRN detail view modal
// ---------------------------------------------------------------------------

function GrnDetailModal({ grnId, onClose }: { grnId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [posting, setPosting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: grn, isLoading } = useQuery<GrnDetail>({
    queryKey: ['grn', grnId],
    queryFn: () => api.get(`/api/grns/${grnId}`).then((r) => r.data.data),
  });

  async function handlePost() {
    setError(null);
    setPosting(true);
    try {
      await api.post(`/api/grns/${grnId}/post`);
      qc.invalidateQueries({ queryKey: ['grns'] });
      qc.invalidateQueries({ queryKey: ['grn', grnId] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
    } catch (err) {
      setError(apiErr(err));
    } finally {
      setPosting(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this draft GRN?')) return;
    setDeleting(true);
    try {
      await api.delete(`/api/grns/${grnId}`);
      qc.invalidateQueries({ queryKey: ['grns'] });
      onClose();
    } catch (err) {
      setError(apiErr(err));
      setDeleting(false);
    }
  }

  return (
    <ModalShell title={grn ? `GRN: ${grn.grn_number}` : 'GRN Detail'} onClose={onClose} wide>
      {isLoading || !grn ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-5">
          {/* Status badge */}
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
              grn.status === 'posted' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
            }`}>
              {grn.status === 'posted' ? 'Posted' : 'Draft'}
            </span>
            {grn.posted_at && (
              <span className="text-xs text-gray-400">Posted {fmtDate(grn.posted_at)}</span>
            )}
          </div>

          {/* Meta */}
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Supplier</p>
              <p className="font-medium text-gray-900">{grn.supplier_name ?? '—'}</p>
              {grn.supplier_phone && <p className="text-xs text-gray-400">{grn.supplier_phone}</p>}
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Supplier Invoice</p>
              <p className="font-medium text-gray-900">{grn.supplier_invoice ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Received</p>
              <p className="font-medium text-gray-900">{fmtDate(grn.received_at)}</p>
            </div>
          </div>

          {/* Items table */}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Item</th>
                  <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider w-20">Qty</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider w-32">Unit Cost</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider w-32">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {grn.items.map((item, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-gray-900">{item.item_name}</p>
                      {item.part_number && (
                        <p className="text-xs font-mono text-gray-400">{item.part_number}</p>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center tabular-nums text-gray-700">
                      {item.quantity} {item.unit}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">
                      {fmtLKR(item.unit_cost)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-gray-900">
                      {fmtLKR(item.line_total)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td colSpan={3} className="px-4 py-2.5 text-sm font-semibold text-gray-700 text-right">
                    Total
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold text-gray-900 tabular-nums">
                    {fmtLKR(grn.total_cost)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {grn.notes && (
            <p className="text-sm text-gray-500 bg-gray-50 rounded-lg px-4 py-3">{grn.notes}</p>
          )}

          {error && (
            <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}

          {grn.status === 'draft' && (
            <div className="flex items-center justify-between border-t border-gray-100 pt-4">
              <button onClick={handleDelete} disabled={deleting}
                className="text-xs font-medium text-red-500 hover:text-red-700 transition-colors disabled:opacity-60">
                {deleting ? 'Deleting…' : 'Delete draft'}
              </button>
              <button onClick={handlePost} disabled={posting}
                className="flex items-center gap-1.5 px-5 py-2 text-sm font-semibold text-white
                  bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"
                  stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {posting ? 'Posting…' : 'Post GRN (receive stock)'}
              </button>
            </div>
          )}
        </div>
      )}
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Suppliers tab
// ---------------------------------------------------------------------------

function SuppliersTab() {
  const [addOpen, setAddOpen]       = useState(false);
  const [editTarget, setEditTarget] = useState<Supplier | null>(null);
  const [search, setSearch]         = useState('');

  const { data: suppliers = [], isLoading } = useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: () => api.get('/api/suppliers').then((r) => r.data.data),
  });

  const filtered = suppliers.filter((s) =>
    !search ||
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.phone ?? '').includes(search) ||
    (s.email ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search suppliers…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg
              focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button onClick={() => setAddOpen(true)}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white
            bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add Supplier
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-white rounded-xl border border-gray-200 animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 flex items-center justify-center h-40 text-sm text-gray-400">
          {search ? 'No suppliers match your search' : 'No suppliers yet — add one above'}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Supplier</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Contact</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center">Parts</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center">GRNs</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3.5">
                    <p className={`text-sm font-medium ${s.active ? 'text-gray-900' : 'text-gray-400'}`}>{s.name}</p>
                    {s.address && <p className="text-xs text-gray-400 truncate max-w-xs">{s.address}</p>}
                    {!s.active && (
                      <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Inactive</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="text-sm text-gray-700">{s.phone ?? '—'}</p>
                    {s.email && <p className="text-xs text-gray-400">{s.email}</p>}
                  </td>
                  <td className="px-5 py-3.5 text-center">
                    <span className="text-sm font-semibold text-gray-700">{s.item_count}</span>
                  </td>
                  <td className="px-5 py-3.5 text-center">
                    <span className="text-sm font-semibold text-gray-700">{s.grn_count}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    <button onClick={() => setEditTarget(s)}
                      className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {addOpen     && <SupplierModal onClose={() => setAddOpen(false)} />}
      {editTarget  && <SupplierModal supplier={editTarget} onClose={() => setEditTarget(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// GRN tab
// ---------------------------------------------------------------------------

function GrnTab({ suppliers }: { suppliers: Supplier[] }) {
  const [newOpen, setNewOpen]         = useState(false);
  const [viewId, setViewId]           = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | 'draft' | 'posted'>('');

  const { data, isLoading } = useQuery<{ grns: GrnSummary[]; total: number }>({
    queryKey: ['grns', statusFilter],
    queryFn: () =>
      api.get('/api/grns', { params: statusFilter ? { status: statusFilter } : {} })
        .then((r) => r.data.data),
  });

  const grns = data?.grns ?? [];

  return (
    <>
      <div className="flex items-center gap-3 mb-4">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {(['', 'draft', 'posted'] as const).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all capitalize ${
                statusFilter === s
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}>
              {s === '' ? 'All' : s}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button onClick={() => setNewOpen(true)}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white
            bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New GRN
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-white rounded-xl border border-gray-200 animate-pulse" />)}
        </div>
      ) : grns.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 flex items-center justify-center h-40 text-sm text-gray-400">
          No GRNs yet — click "New GRN" to receive stock
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">GRN #</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Supplier</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Supplier Inv.</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Date</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center">Items</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Total Cost</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider w-24">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {grns.map((g) => (
                <tr key={g.id}
                  onClick={() => setViewId(g.id)}
                  className="hover:bg-gray-50 cursor-pointer transition-colors">
                  <td className="px-5 py-3.5">
                    <span className="text-sm font-mono font-bold text-gray-900">{g.grn_number}</span>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-gray-700">{g.supplier_name ?? '—'}</td>
                  <td className="px-5 py-3.5 text-sm text-gray-500 font-mono">{g.supplier_invoice ?? '—'}</td>
                  <td className="px-5 py-3.5 text-sm text-gray-600">{fmtDate(g.received_at)}</td>
                  <td className="px-5 py-3.5 text-center">
                    <span className="text-sm font-semibold text-gray-700">{g.item_count}</span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <span className="text-sm font-semibold text-gray-900 tabular-nums">{fmtLKR(g.total_cost)}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                      g.status === 'posted'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}>
                      {g.status === 'posted' ? 'Posted' : 'Draft'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {newOpen && (
        <GrnForm
          suppliers={suppliers}
          onClose={() => setNewOpen(false)}
          onSaved={() => setNewOpen(false)}
        />
      )}
      {viewId && <GrnDetailModal grnId={viewId} onClose={() => setViewId(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Tab = 'suppliers' | 'grn';

export function SuppliersPage() {
  const [tab, setTab] = useState<Tab>('suppliers');

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: () => api.get('/api/suppliers').then((r) => r.data.data),
  });

  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-5xl mx-auto space-y-6">

        <div>
          <h1 className="text-lg font-semibold text-gray-900">Suppliers</h1>
          <p className="text-xs text-gray-400 mt-0.5">Manage suppliers and receive stock with GRNs</p>
        </div>

        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
          {([['suppliers', 'Suppliers'], ['grn', 'Goods Received']] as [Tab, string][]).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                tab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'suppliers' && <SuppliersTab />}
        {tab === 'grn'       && <GrnTab suppliers={suppliers} />}

      </div>
    </AppLayout>
  );
}
