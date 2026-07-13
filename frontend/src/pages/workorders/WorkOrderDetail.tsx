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
import type { WorkOrder, WorkOrderStatus, WorkOrderItem, User, InventoryItem, ServiceItem } from '../../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<WorkOrderStatus, { label: string; cls: string }> = {
  received:      { label: 'Received',      cls: 'bg-gray-100 text-gray-600' },
  diagnosing:    { label: 'Diagnosing',    cls: 'bg-amber-100 text-amber-700' },
  waiting_parts: { label: 'Waiting Parts', cls: 'bg-orange-100 text-orange-700' },
  in_progress:   { label: 'In Progress',   cls: 'bg-blue-100 text-blue-700' },
  quality_check: { label: 'Quality Check', cls: 'bg-indigo-100 text-indigo-700' },
  ready:         { label: 'Ready',         cls: 'bg-green-100 text-green-700' },
  delivered:     { label: 'Delivered',     cls: 'bg-purple-100 text-purple-700' },
  cancelled:     { label: 'Cancelled',     cls: 'bg-red-100 text-red-600' },
};

const STEPPER_STATUSES: WorkOrderStatus[] = [
  'received', 'diagnosing', 'waiting_parts', 'in_progress',
  'quality_check', 'ready', 'delivered',
];

const TRANSITIONS: Record<WorkOrderStatus, readonly WorkOrderStatus[]> = {
  received:      ['diagnosing', 'cancelled'],
  diagnosing:    ['waiting_parts', 'in_progress', 'cancelled'],
  waiting_parts: ['in_progress', 'cancelled'],
  in_progress:   ['quality_check', 'cancelled'],
  quality_check: ['ready', 'in_progress'],
  ready:         ['delivered', 'cancelled'],
  delivered:     [],
  cancelled:     [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatLKR(n: number) {
  return `LKR ${Math.round(n).toLocaleString('en-US')}`;
}

function formatDate(s: string) {
  return new Date(s).toLocaleDateString('en-LK', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: WorkOrderStatus }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, cls: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Status stepper
// ---------------------------------------------------------------------------

function StatusStepper({ status }: { status: WorkOrderStatus }) {
  if (status === 'cancelled') {
    return (
      <div className="flex items-center gap-2 px-6 py-3 border-b border-gray-100 bg-red-50">
        <span className="text-xs font-semibold text-red-600">Work order cancelled</span>
      </div>
    );
  }

  const activeIdx = STEPPER_STATUSES.indexOf(status);

  return (
    <div className="flex items-center gap-0 px-6 py-3 border-b border-gray-100 overflow-x-auto">
      {STEPPER_STATUSES.map((s, i) => {
        const done    = i < activeIdx;
        const current = i === activeIdx;
        return (
          <div key={s} className="flex items-center flex-shrink-0">
            <div className="flex flex-col items-center">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center border-2 transition-colors ${
                done    ? 'bg-blue-600 border-blue-600' :
                current ? 'bg-white border-blue-600' :
                          'bg-white border-gray-200'
              }`}>
                {done ? (
                  <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <div className={`w-1.5 h-1.5 rounded-full ${current ? 'bg-blue-600' : 'bg-gray-200'}`} />
                )}
              </div>
              <span className={`text-[9px] font-medium mt-1 whitespace-nowrap ${
                done || current ? 'text-blue-600' : 'text-gray-400'
              }`}>
                {STATUS_CONFIG[s].label}
              </span>
            </div>
            {i < STEPPER_STATUSES.length - 1 && (
              <div className={`h-0.5 w-8 mb-4 mx-1 flex-shrink-0 transition-colors ${
                i < activeIdx ? 'bg-blue-600' : 'bg-gray-200'
              }`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Update details form
// ---------------------------------------------------------------------------

const detailsSchema = z.object({
  customer_complaint: z.string().optional(),
  diagnosis:          z.string().optional(),
  internal_notes:     z.string().optional(),
  mileage_out:        z.preprocess(
    (v) => (v === '' || v == null ? undefined : Number(v)),
    z.number().int().nonnegative().optional(),
  ),
  labour_cost: z.preprocess(
    (v) => (v === '' || v == null ? 0 : Number(v)),
    z.number().nonnegative().default(0),
  ),
  assigned_to:   z.string().uuid().nullable().optional(),
  promised_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
});

type DetailsFormData = z.infer<typeof detailsSchema>;

function DetailsSection({ wo, users }: { wo: WorkOrder; users: User[] }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const { register, handleSubmit, reset } = useForm<DetailsFormData>({
    resolver: zodResolver(detailsSchema) as any,
    defaultValues: {
      customer_complaint: wo.customer_complaint ?? '',
      diagnosis:          wo.diagnosis ?? '',
      internal_notes:     wo.internal_notes ?? '',
      mileage_out:        wo.mileage_out ?? undefined,
      labour_cost:        wo.labour_cost,
      assigned_to:        wo.assigned_to ?? '',
      promised_date:      wo.promised_date?.slice(0, 10) ?? '',
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: DetailsFormData) =>
      api.put(`/api/work-orders/${wo.id}`, {
        ...data,
        assigned_to:   data.assigned_to   || null,
        promised_date: data.promised_date || undefined,
      }).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-order', wo.id] });
      setEditing(false);
    },
  });

  const isFinal = wo.status === 'delivered' || wo.status === 'cancelled';

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">Details</h2>
        {!isFinal && (
          editing ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { reset(); setEditing(false); }}
                className="text-xs text-gray-500 hover:text-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit((d) => updateMutation.mutate(d))}
                disabled={updateMutation.isPending}
                className="px-3 py-1 text-xs font-semibold text-white bg-blue-600 rounded-lg
                  hover:bg-blue-700 disabled:opacity-60 transition-colors"
              >
                {updateMutation.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit
            </button>
          )
        )}
      </div>

      <div className="px-6 py-5 space-y-4">
        {editing ? (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Labour cost (LKR)</label>
                <input
                  type="number"
                  step="0.01"
                  {...register('labour_cost')}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Mileage out (km)</label>
                <input
                  type="number"
                  {...register('mileage_out')}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Assigned technician</label>
                <select
                  {...register('assigned_to')}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white
                    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Unassigned</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Promised date</label>
                <input
                  type="date"
                  {...register('promised_date')}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Customer complaint</label>
              <textarea
                rows={3}
                {...register('customer_complaint')}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none
                  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Diagnosis / findings</label>
              <textarea
                rows={3}
                {...register('diagnosis')}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none
                  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Internal notes</label>
              <textarea
                rows={2}
                {...register('internal_notes')}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none
                  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
            <InfoRow label="Assigned to"   value={wo.assigned_to_name} />
            <InfoRow label="Promised date" value={wo.promised_date ? formatDate(wo.promised_date) : null} />
            <InfoRow label="Mileage in"    value={wo.mileage_in != null ? `${wo.mileage_in.toLocaleString()} km` : null} />
            <InfoRow label="Mileage out"   value={wo.mileage_out != null ? `${wo.mileage_out.toLocaleString()} km` : null} />
            <InfoRow label="Labour cost"   value={formatLKR(wo.labour_cost)} />
            {wo.customer_complaint && (
              <div className="col-span-2 sm:col-span-3">
                <InfoRow label="Customer complaint" value={wo.customer_complaint} />
              </div>
            )}
            {wo.diagnosis && (
              <div className="col-span-2 sm:col-span-3">
                <InfoRow label="Diagnosis" value={wo.diagnosis} />
              </div>
            )}
            {wo.internal_notes && (
              <div className="col-span-2 sm:col-span-3">
                <InfoRow label="Internal notes" value={wo.internal_notes} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-0.5">{label}</dt>
      <dd className="text-sm text-gray-800">{value || <span className="text-gray-400">—</span>}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add item form (inline)
// ---------------------------------------------------------------------------

const addItemSchema = z.object({
  inventory_item_id: z.string().uuid().nullable().optional(),
  service_item_id:   z.string().uuid().nullable().optional(),
  description:       z.string().min(1, 'Required'),
  quantity:          z.preprocess((v) => Number(v), z.number().positive('Must be > 0')),
  unit_price:        z.preprocess((v) => Number(v), z.number().nonnegative()),
});

type AddItemFormData = z.infer<typeof addItemSchema>;

function AddItemRow({
  workOrderId,
  onAdded,
}: {
  workOrderId: string;
  onAdded: () => void;
}) {
  const [mode, setMode]               = useState<'part' | 'service'>('part');
  const [selectedInv, setSelectedInv] = useState<InventoryItem | null>(null);
  const [selectedSvc, setSelectedSvc] = useState<ServiceItem | null>(null);

  const { register, handleSubmit, setValue, watch, reset, formState: { errors } } = useForm<AddItemFormData>({
    resolver: zodResolver(addItemSchema) as any,
    defaultValues: { quantity: 1, unit_price: 0, description: '' },
  });

  const addMutation = useMutation({
    mutationFn: (data: AddItemFormData) =>
      api.post(`/api/work-orders/${workOrderId}/items`, data).then((r) => r.data.data),
    onSuccess: (result) => {
      onAdded();
      reset({ quantity: 1, unit_price: 0, description: '' });
      setSelectedInv(null);
      setSelectedSvc(null);
      if (result.low_stock) {
        console.warn('Low stock warning for item');
      }
    },
  });

  const watchQty       = watch('quantity');
  const watchUnitPrice = watch('unit_price');
  const lineTotal      = (Number(watchQty) || 0) * (Number(watchUnitPrice) || 0);

  function switchMode(next: 'part' | 'service') {
    setMode(next);
    setSelectedInv(null);
    setSelectedSvc(null);
    setValue('inventory_item_id', null);
    setValue('service_item_id', null);
    setValue('description', '');
    setValue('unit_price', 0);
  }

  function handleSelectInv(item: InventoryItem) {
    setSelectedInv(item);
    setValue('inventory_item_id', item.id);
    setValue('description', item.name);
    setValue('unit_price', item.selling_price);
  }

  function handleClearInv() {
    setSelectedInv(null);
    setValue('inventory_item_id', null);
    setValue('description', '');
    setValue('unit_price', 0);
  }

  function handleSelectSvc(item: ServiceItem) {
    setSelectedSvc(item);
    setValue('service_item_id', item.id);
    setValue('description', item.name);
    setValue('unit_price', item.price);
  }

  function handleClearSvc() {
    setSelectedSvc(null);
    setValue('service_item_id', null);
    setValue('description', '');
    setValue('unit_price', 0);
  }

  return (
    <tr className="bg-blue-50">
      <td className="px-4 py-2" colSpan={1}>
        <div className="flex gap-1 mb-1.5">
          <button
            type="button"
            onClick={() => switchMode('part')}
            className={`px-2 py-0.5 text-[10px] font-semibold rounded-md border transition-colors ${
              mode === 'part'
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}
          >
            Part
          </button>
          <button
            type="button"
            onClick={() => switchMode('service')}
            className={`px-2 py-0.5 text-[10px] font-semibold rounded-md border transition-colors ${
              mode === 'service'
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}
          >
            Service
          </button>
        </div>
        {mode === 'part' ? (
          <InventorySearch
            size="sm"
            value={selectedInv}
            onSelect={handleSelectInv}
            onClear={handleClearInv}
            placeholder="Search parts…"
            className="mb-1.5"
          />
        ) : (
          <ServiceSearchInput
            size="sm"
            value={selectedSvc}
            onSelect={handleSelectSvc}
            onClear={handleClearSvc}
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
      <td className="px-2 py-2 w-20">
        <input
          type="number"
          step="0.01"
          min="0.01"
          {...register('quantity')}
          className="w-full px-2 py-1 text-xs border border-blue-300 rounded-lg
            focus:outline-none focus:ring-1 focus:ring-blue-500 tabular-nums"
        />
      </td>
      <td className="px-2 py-2 w-28">
        <input
          type="number"
          step="0.01"
          min="0"
          {...register('unit_price')}
          className="w-full px-2 py-1 text-xs border border-blue-300 rounded-lg
            focus:outline-none focus:ring-1 focus:ring-blue-500 tabular-nums"
        />
      </td>
      <td className="px-4 py-2 text-xs text-gray-500 tabular-nums whitespace-nowrap">
        {formatLKR(lineTotal)}
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={handleSubmit((d) => addMutation.mutate(d))}
            disabled={addMutation.isPending}
            className="px-3 py-1 text-xs font-semibold text-white bg-blue-600 rounded-lg
              hover:bg-blue-700 disabled:opacity-60 transition-colors whitespace-nowrap"
          >
            {addMutation.isPending ? '…' : 'Add'}
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
// Report Faulty Part modal
// ---------------------------------------------------------------------------

const faultSchema = z.object({
  faultDescription: z.string().min(1, 'Please describe the fault'),
});
type FaultFormData = z.infer<typeof faultSchema>;

function ReportFaultModal({
  item,
  wo,
  onClose,
}: {
  item: WorkOrderItem;
  wo: WorkOrder;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm<FaultFormData>({
    resolver: zodResolver(faultSchema) as any,
  });

  const mutation = useMutation({
    mutationFn: (data: FaultFormData) =>
      api.post('/api/fault-reports', {
        workOrderItemId:  item.id,
        faultDescription: data.faultDescription,
      }).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fault-reports'] });
      onClose();
    },
  });

  const apiError = mutation.error
    ? ((mutation.error as { response?: { data?: { error?: { message?: string } } } })
        .response?.data?.error?.message ?? 'Failed to submit report')
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Report Faulty Part</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 rounded transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="px-5 pt-4 pb-5 space-y-4">

          {/* Context */}
          <div className="rounded-lg bg-gray-50 px-3 py-3 space-y-1.5 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 w-20 flex-shrink-0">Part</span>
              <span className="font-medium text-gray-900 truncate">{item.description}</span>
            </div>
            {item.part_number && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-20 flex-shrink-0">Part #</span>
                <span className="font-mono text-gray-600">{item.part_number}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 w-20 flex-shrink-0">Work order</span>
              <span className="font-mono font-semibold text-gray-900">{wo.order_number}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 w-20 flex-shrink-0">Vehicle</span>
              <span className="font-mono text-gray-700">{wo.plate_number}</span>
              <span className="text-gray-500">{wo.make} {wo.model}</span>
            </div>
            {(item.supplier_name || item.supplier_phone) && (
              <div className="pt-1 border-t border-gray-200 mt-1.5 space-y-1">
                {item.supplier_name && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 w-20 flex-shrink-0">Supplier</span>
                    <span className="text-gray-700">{item.supplier_name}</span>
                  </div>
                )}
                {item.supplier_phone && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 w-20 flex-shrink-0">Phone</span>
                    <a href={`tel:${item.supplier_phone}`}
                      className="text-blue-600 hover:underline">{item.supplier_phone}</a>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Fault description */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Describe the fault <span className="text-red-400">*</span>
            </label>
            <textarea
              {...register('faultDescription')}
              rows={4}
              autoFocus
              placeholder="e.g. Part failed after 2 days — bearing seized, incorrect dimensions, cracked housing…"
              className={`w-full px-3 py-2 text-sm border rounded-lg resize-none
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                ${errors.faultDescription ? 'border-red-300' : 'border-gray-200'}`}
            />
            {errors.faultDescription && (
              <p className="text-xs text-red-500 mt-0.5">{errors.faultDescription.message}</p>
            )}
          </div>

          {apiError && (
            <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{apiError}</p>
          )}

          <div className="flex items-center justify-end gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={mutation.isPending}
              className="px-5 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg
                hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors">
              {mutation.isPending ? 'Submitting…' : 'Submit Fault Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Line items table
// ---------------------------------------------------------------------------

function ItemsSection({ wo }: { wo: WorkOrder }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [faultItem, setFaultItem] = useState<WorkOrderItem | null>(null);
  const [editingLabour, setEditingLabour] = useState(false);
  const [labourValue, setLabourValue] = useState(String(wo.labour_cost));
  const isFinal = wo.status === 'delivered' || wo.status === 'cancelled';

  const labourMutation = useMutation({
    mutationFn: (cost: number) =>
      api.put(`/api/work-orders/${wo.id}`, { labour_cost: cost }).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-order', wo.id] });
      setEditingLabour(false);
    },
  });

  function commitLabour() {
    const parsed = parseFloat(labourValue);
    if (!isNaN(parsed) && parsed >= 0) {
      labourMutation.mutate(parsed);
    } else {
      setLabourValue(String(wo.labour_cost));
      setEditingLabour(false);
    }
  }

  const deleteMutation = useMutation({
    mutationFn: (itemId: string) =>
      api.delete(`/api/work-orders/${wo.id}/items/${itemId}`).then((r) => r.data.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['work-order', wo.id] }),
  });

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">Parts &amp; Services</h2>
        {!isFinal && (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border transition-colors ${
              adding
                ? 'bg-gray-100 border-gray-200 text-gray-600 hover:bg-gray-200'
                : 'bg-blue-50 border-blue-200 text-blue-600 hover:bg-blue-100'
            }`}
          >
            {adding ? 'Cancel' : (
              <>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Add item
              </>
            )}
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">Description</th>
              <th className="px-2 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider w-20">Qty</th>
              <th className="px-2 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider w-28">Unit price</th>
              <th className="px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">Total</th>
              {!isFinal && <th className="px-3 py-2.5 w-10" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {wo.items.map((item: WorkOrderItem) => (
              <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <p className="text-sm text-gray-800">{item.description}</p>
                  {item.part_number && (
                    <p className="text-xs text-gray-400 font-mono">{item.part_number}</p>
                  )}
                  {item.service_item_id && (
                    <span className="inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">
                      Service
                    </span>
                  )}
                </td>
                <td className="px-2 py-3 text-sm text-gray-600 tabular-nums">{item.quantity}</td>
                <td className="px-2 py-3 text-sm text-gray-600 tabular-nums whitespace-nowrap">
                  {formatLKR(item.unit_price)}
                </td>
                <td className="px-4 py-3 text-sm font-semibold text-gray-900 tabular-nums whitespace-nowrap">
                  {formatLKR(item.line_total)}
                </td>
                {!isFinal && (
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1">
                      {item.inventory_item_id && (
                        <button
                          type="button"
                          onClick={() => setFaultItem(item)}
                          className="p-1 text-gray-300 hover:text-orange-500 rounded transition-colors"
                          title="Report faulty part"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round"
                              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => deleteMutation.mutate(item.id)}
                        disabled={deleteMutation.isPending}
                        className="p-1 text-gray-300 hover:text-red-500 rounded transition-colors disabled:opacity-50"
                        title="Remove item"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round"
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}

            {adding && (
              <AddItemRow
                workOrderId={wo.id}
                onAdded={() => {
                  queryClient.invalidateQueries({ queryKey: ['work-order', wo.id] });
                  setAdding(false);
                }}
              />
            )}

            {wo.items.length === 0 && !adding && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400">
                  No parts or services added yet
                </td>
              </tr>
            )}
          </tbody>

          {/* Totals */}
          {(wo.items.length > 0 || wo.labour_cost > 0) && (
            <tfoot className="border-t border-gray-200 bg-gray-50">
              <tr>
                <td colSpan={3} className="px-4 py-2 text-xs font-medium text-gray-500 text-right">Parts subtotal</td>
                <td colSpan={2} className="px-4 py-2 text-sm text-gray-700 tabular-nums whitespace-nowrap">
                  {formatLKR(wo.parts_total)}
                </td>
              </tr>
              <tr>
                <td colSpan={3} className="px-4 py-2 text-xs font-medium text-gray-500 text-right">Labour</td>
                <td colSpan={2} className="px-4 py-2">
                  {!isFinal && editingLabour ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={labourValue}
                        onChange={(e) => setLabourValue(e.target.value)}
                        onBlur={commitLabour}
                        onKeyDown={(e) => { if (e.key === 'Enter') commitLabour(); if (e.key === 'Escape') { setLabourValue(String(wo.labour_cost)); setEditingLabour(false); } }}
                        autoFocus
                        className="w-32 px-2 py-0.5 text-sm border border-blue-400 rounded-lg tabular-nums
                          focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      {labourMutation.isPending && <span className="text-xs text-gray-400">Saving…</span>}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { if (!isFinal) { setLabourValue(String(wo.labour_cost)); setEditingLabour(true); } }}
                      title={isFinal ? undefined : 'Click to edit labour cost'}
                      className={`text-sm text-gray-700 tabular-nums whitespace-nowrap ${!isFinal ? 'hover:text-blue-600 cursor-pointer underline decoration-dashed underline-offset-2' : ''}`}
                    >
                      {formatLKR(wo.labour_cost)}
                    </button>
                  )}
                </td>
              </tr>
              <tr className="border-t border-gray-200">
                <td colSpan={3} className="px-4 py-2.5 text-xs font-bold text-gray-700 uppercase tracking-wider text-right">
                  Total
                </td>
                <td colSpan={2} className="px-4 py-2.5 text-base font-bold text-gray-900 tabular-nums whitespace-nowrap">
                  {formatLKR(wo.total)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {faultItem && (
        <ReportFaultModal item={faultItem} wo={wo} onClose={() => setFaultItem(null)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page skeleton
// ---------------------------------------------------------------------------

function PageSkeleton() {
  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-5xl mx-auto space-y-6">
        <div className="h-4 w-48 bg-gray-100 rounded animate-pulse" />
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div className="h-7 w-36 bg-gray-100 rounded animate-pulse" />
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-2.5 w-14 bg-gray-100 rounded animate-pulse" />
                <div className="h-4 w-24 bg-gray-100 rounded animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function WorkOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: wo, isLoading, isError } = useQuery<WorkOrder>({
    queryKey: ['work-order', id],
    queryFn: () => api.get(`/api/work-orders/${id}`).then((r) => r.data.data),
    enabled: !!id,
  });

  const { data: users } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: () => api.get('/api/users').then((r) => r.data.data),
    enabled: !!wo,
  });

  const statusMutation = useMutation({
    mutationFn: (status: WorkOrderStatus) =>
      api.patch(`/api/work-orders/${id}/status`, { status }).then((r) => r.data.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['work-order', id] }),
  });

  const invoiceMutation = useMutation({
    mutationFn: () =>
      api.post(`/api/invoices/from-work-order/${id}`, {}).then((r) => r.data.data),
    onSuccess: (inv) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      navigate(`/invoices/${inv.id}`);
    },
  });

  if (isLoading) return <PageSkeleton />;

  if (isError || !wo) {
    return (
      <AppLayout>
        <div className="px-8 py-8 max-w-5xl mx-auto">
          <button
            onClick={() => navigate('/work-orders')}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-6 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Work Orders
          </button>
          <p className="text-sm text-red-500">Work order not found.</p>
        </div>
      </AppLayout>
    );
  }

  const allowed = TRANSITIONS[wo.status];
  const isFinal = wo.status === 'delivered' || wo.status === 'cancelled';
  const canInvoice = wo.status === 'ready' || wo.status === 'delivered';

  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-5xl mx-auto space-y-6">

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <button onClick={() => navigate('/work-orders')} className="hover:text-gray-700 transition-colors">
            Work Orders
          </button>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-gray-700 font-mono font-semibold">{wo.order_number}</span>
        </div>

        {/* Header card */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Company header */}
          <CompanyHeader docTitle="WORK ORDER" docNumber={wo.order_number} />

          {/* Header bar */}
          <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-xl font-mono font-bold text-gray-900">{wo.order_number}</h1>
                <StatusBadge status={wo.status} />
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <button
                  onClick={() => navigate(`/vehicles/${wo.vehicle_id}`)}
                  className="font-mono font-semibold text-gray-900 hover:text-blue-600 transition-colors"
                >
                  {wo.plate_number}
                </button>
                <span className="text-gray-300">·</span>
                <span>{wo.make} {wo.model}{wo.year ? ` ${wo.year}` : ''}</span>
                <span className="text-gray-300">·</span>
                <button
                  onClick={() => navigate(`/customers/${wo.customer_id}`)}
                  className="hover:text-blue-600 transition-colors"
                >
                  {wo.customer_name}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {invoiceMutation.isError && (
                <span className="text-xs text-red-500">
                  {(invoiceMutation.error as { response?: { data?: { error?: { message?: string } } } })
                    .response?.data?.error?.message ?? 'Failed'}
                </span>
              )}
              {canInvoice && (
                <button
                  onClick={() => invoiceMutation.mutate()}
                  disabled={invoiceMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white
                    bg-green-600 hover:bg-green-700 disabled:opacity-60 rounded-lg transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  {invoiceMutation.isPending ? 'Creating…' : 'Invoice'}
                </button>
              )}

              {!isFinal && allowed.map((next) => (
                <button
                  key={next}
                  onClick={() => statusMutation.mutate(next)}
                  disabled={statusMutation.isPending}
                  className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors disabled:opacity-60 ${
                    next === 'cancelled'
                      ? 'text-red-600 border border-red-200 hover:bg-red-50'
                      : 'text-white bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {statusMutation.isPending ? '…' : `→ ${STATUS_CONFIG[next].label}`}
                </button>
              ))}
            </div>
          </div>

          {/* Stepper */}
          <StatusStepper status={wo.status} />

          {/* Meta row */}
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-4 px-6 py-4 text-sm">
            <InfoRow label="Created" value={formatDate(wo.created_at)} />
            {wo.promised_date && <InfoRow label="Promised" value={formatDate(wo.promised_date)} />}
            {wo.completed_at  && <InfoRow label="Completed" value={formatDate(wo.completed_at)} />}
            <InfoRow label="Customer phone" value={wo.customer_phone} />
          </div>
        </div>

        {/* Details */}
        <DetailsSection wo={wo} users={users ?? []} />

        {/* Line items */}
        <ItemsSection wo={wo} />

      </div>
    </AppLayout>
  );
}
