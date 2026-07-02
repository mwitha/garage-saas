import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '../../components/AppLayout';
import { CustomerForm, customerToFormData } from '../../components/customers/CustomerForm';
import type { CustomerFormData } from '../../components/customers/CustomerForm';
import { VehicleForm } from '../../components/vehicles/VehicleForm';
import type { VehicleFormData } from '../../components/vehicles/VehicleForm';
import { VehicleCard } from '../../components/vehicles/VehicleCard';
import api from '../../lib/api';
import type { CustomerWithDetails, WorkOrderStatus, OutstandingInvoice } from '../../types';

// ---- Status badge ----------------------------------------------------------

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

function StatusBadge({ status }: { status: WorkOrderStatus }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, cls: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

// ---- Helpers ---------------------------------------------------------------

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-LK', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30)  return `${days}d ago`;
  return formatDate(dateStr);
}

// ---- Info row (key / value pair inside the customer card) ------------------

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-0.5">{label}</dt>
      <dd className="text-sm text-gray-800">{value || <span className="text-gray-400">—</span>}</dd>
    </div>
  );
}

// ---- Skeleton for the whole page -------------------------------------------

function PageSkeleton() {
  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-5xl mx-auto space-y-6">
        <div className="h-5 w-32 bg-gray-100 rounded animate-pulse" />
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div className="h-6 w-48 bg-gray-100 rounded animate-pulse" />
          <div className="grid grid-cols-2 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-2.5 w-16 bg-gray-100 rounded animate-pulse" />
                <div className="h-4 w-32 bg-gray-100 rounded animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

// ---- Delete confirmation dialog --------------------------------------------

function DeleteDialog({
  name, onConfirm, onCancel, isPending,
}: {
  name: string; onConfirm: () => void; onCancel: () => void; isPending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} aria-hidden />
      <div className="relative bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
        <h3 className="text-base font-semibold text-gray-900 mb-2">Delete customer?</h3>
        <p className="text-sm text-gray-500 mb-6">
          <strong>{name}</strong> will be soft-deleted. Their vehicles and work orders are kept.
        </p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={isPending}
            className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg
              hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors">
            {isPending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Outstanding Payments --------------------------------------------------

const INVOICE_STATUS: Record<'draft' | 'sent' | 'overdue', { label: string; cls: string }> = {
  draft:   { label: 'Draft',   cls: 'bg-gray-100 text-gray-600' },
  sent:    { label: 'Sent',    cls: 'bg-blue-100 text-blue-700' },
  overdue: { label: 'Overdue', cls: 'bg-red-100 text-red-600' },
};

function OutstandingPayments({ invoices }: { invoices: OutstandingInvoice[] }) {
  const total = invoices.reduce((sum, inv) => sum + inv.total, 0);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Outstanding Payments</h2>
          <p className="text-xs text-gray-400 mt-0.5">Unpaid invoices</p>
        </div>
        {invoices.length > 0 && (
          <span className="text-sm font-semibold text-red-600">
            LKR {Math.round(total).toLocaleString('en-US')}
          </span>
        )}
      </div>

      {invoices.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <svg className="w-8 h-8 text-gray-200 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-gray-400">No outstanding payments</p>
        </div>
      ) : (
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-gray-100">
              {['Invoice', 'Vehicle', 'Work Order', 'Status', 'Due Date', 'Amount'].map((h) => (
                <th key={h} className="px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {invoices.map((inv) => {
              const cfg = INVOICE_STATUS[inv.status];
              return (
                <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-3.5">
                    <span className="text-xs font-mono font-semibold text-gray-700">{inv.invoice_number}</span>
                  </td>
                  <td className="px-6 py-3.5">
                    <p className="text-sm font-medium text-gray-900">{inv.plate_number}</p>
                    <p className="text-xs text-gray-400">{inv.make} {inv.model}</p>
                  </td>
                  <td className="px-6 py-3.5">
                    <span className="text-xs font-mono text-gray-600">{inv.order_number}</span>
                  </td>
                  <td className="px-6 py-3.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cfg.cls}`}>
                      {cfg.label}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 text-sm text-gray-500 whitespace-nowrap">
                    {inv.due_date
                      ? <span className={new Date(inv.due_date) < new Date() ? 'text-red-600 font-medium' : ''}>
                          {formatDate(inv.due_date)}
                        </span>
                      : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-6 py-3.5 text-sm font-semibold text-gray-900 whitespace-nowrap">
                    LKR {Math.round(inv.total).toLocaleString('en-US')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---- Page ------------------------------------------------------------------

export function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [editOpen,   setEditOpen]   = useState(false);
  const [addCarOpen, setAddCarOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: customer, isLoading, isError } = useQuery<CustomerWithDetails>({
    queryKey: ['customer', id],
    queryFn: () => api.get(`/api/customers/${id}`).then((r) => r.data.data),
    enabled: !!id,
  });

  const updateMutation = useMutation({
    mutationFn: (body: CustomerFormData) =>
      api.put(`/api/customers/${id}`, {
        ...body,
        email:      body.email      || undefined,
        city:       body.city       || undefined,
        address:    body.address    || undefined,
        nic_number: body.nic_number || undefined,
        notes:      body.notes      || undefined,
      }).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer', id] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setEditOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/customers/${id}`).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      navigate('/customers');
    },
  });

  const addVehicleMutation = useMutation({
    mutationFn: (body: VehicleFormData) =>
      api.post(`/api/customers/${id}/vehicles`, {
        ...body,
        year:            body.year            ?? undefined,
        color:           body.color           || undefined,
        fuel_type:       body.fuel_type       ?? undefined,
        engine_capacity: body.engine_capacity || undefined,
        engine_number:   body.engine_number   || undefined,
        transmission:    body.transmission    ?? undefined,
        mileage:         body.mileage         ?? undefined,
        vin:             body.vin             || undefined,
        ac_system:       body.ac_system        || undefined,
        notes:           body.notes           || undefined,
      }).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer', id] });
      setAddCarOpen(false);
    },
  });

  const addVehicleError = addVehicleMutation.error
    ? ((addVehicleMutation.error as { response?: { data?: { error?: { message?: string } } } })
        .response?.data?.error?.message ?? 'Something went wrong')
    : null;

  if (isLoading) return <PageSkeleton />;

  if (isError || !customer) {
    return (
      <AppLayout>
        <div className="px-8 py-8 max-w-5xl mx-auto">
          <button onClick={() => navigate('/customers')}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-6 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Customers
          </button>
          <p className="text-sm text-red-500">Customer not found.</p>
        </div>
      </AppLayout>
    );
  }

  const editError = updateMutation.error
    ? ((updateMutation.error as { response?: { data?: { error?: { message?: string } } } })
        .response?.data?.error?.message ?? 'Something went wrong')
    : null;

  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-5xl mx-auto space-y-6">

        {/* Back nav */}
        <button
          onClick={() => navigate('/customers')}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Customers
        </button>

        {/* Customer info card */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div>
              <h1 className="text-lg font-semibold text-gray-900">{customer.name}</h1>
              <p className="text-xs text-gray-400 mt-0.5">
                Customer since {formatDate(customer.created_at)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { updateMutation.reset(); setEditOpen(true); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600
                  border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Edit
              </button>
              <button
                onClick={() => setDeleteOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600
                  border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete
              </button>
            </div>
          </div>

          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 px-6 py-5">
            <InfoRow label="Phone"  value={customer.phone} />
            <InfoRow label="Email"  value={customer.email} />
            <InfoRow label="City"   value={customer.city} />
            <InfoRow label="Address" value={customer.address} />
            <InfoRow label="NIC"    value={customer.nic_number} />
            {customer.notes && (
              <div className="col-span-2 sm:col-span-3">
                <InfoRow label="Notes" value={customer.notes} />
              </div>
            )}
          </dl>
        </div>

        {/* Vehicles */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">
              Vehicle Ownership History
              {customer.vehicles.length > 0 && (
                <span className="ml-2 text-xs font-normal text-gray-400">({customer.vehicles.length})</span>
              )}
            </h2>
            <button
              onClick={() => { addVehicleMutation.reset(); setAddCarOpen(true); }}
              className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-blue-600
                border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add vehicle
            </button>
          </div>

          {customer.vehicles.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <svg className="w-8 h-8 text-gray-200 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0M13 17V7a1 1 0 00-1-1H6l-2 4v6" />
              </svg>
              <p className="text-sm text-gray-400 mb-2">No vehicles registered</p>
              <button
                onClick={() => { addVehicleMutation.reset(); setAddCarOpen(true); }}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                Add first vehicle →
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-5">
              {customer.vehicles.map((v) => (
                <VehicleCard key={v.id} vehicle={v} />
              ))}
            </div>
          )}
        </div>

        {/* Service history */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">Previous Service History</h2>
            <p className="text-xs text-gray-400 mt-0.5">Last 20 work orders</p>
          </div>

          {customer.recent_work_orders.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <svg className="w-8 h-8 text-gray-200 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p className="text-sm text-gray-400">No service history yet</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Order', 'Vehicle', 'Complaint', 'Status', 'Date'].map((h) => (
                    <th key={h} className="px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {customer.recent_work_orders.map((wo) => (
                  <tr key={wo.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-3.5">
                      <span className="text-xs font-mono font-semibold text-gray-700">{wo.order_number}</span>
                    </td>
                    <td className="px-6 py-3.5">
                      <p className="text-sm font-medium text-gray-900">{wo.plate_number}</p>
                      <p className="text-xs text-gray-400">{wo.make} {wo.model}</p>
                    </td>
                    <td className="px-6 py-3.5 max-w-xs">
                      <p className="text-sm text-gray-600 truncate">
                        {wo.customer_complaint ?? <span className="text-gray-400 italic">—</span>}
                      </p>
                    </td>
                    <td className="px-6 py-3.5">
                      <StatusBadge status={wo.status} />
                    </td>
                    <td className="px-6 py-3.5 text-sm text-gray-500 whitespace-nowrap">
                      {relativeTime(wo.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {/* Outstanding Payments */}
        <OutstandingPayments invoices={customer.outstanding_invoices} />

      </div>

      {/* Edit modal */}
      <CustomerForm
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit customer"
        defaultValues={customerToFormData(customer)}
        onSubmit={(d) => updateMutation.mutate(d)}
        isPending={updateMutation.isPending}
        error={editError}
      />

      {/* Add vehicle modal */}
      <VehicleForm
        open={addCarOpen}
        onClose={() => setAddCarOpen(false)}
        title="Add vehicle"
        onSubmit={(d) => addVehicleMutation.mutate(d)}
        isPending={addVehicleMutation.isPending}
        error={addVehicleError}
      />

      {/* Delete confirmation */}
      {deleteOpen && (
        <DeleteDialog
          name={customer.name}
          onConfirm={() => deleteMutation.mutate()}
          onCancel={() => setDeleteOpen(false)}
          isPending={deleteMutation.isPending}
        />
      )}
    </AppLayout>
  );
}
