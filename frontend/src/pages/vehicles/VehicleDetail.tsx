import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '../../components/AppLayout';
import { VehicleForm, vehicleToFormData } from '../../components/vehicles/VehicleForm';
import type { VehicleFormData } from '../../components/vehicles/VehicleForm';
import api from '../../lib/api';
import type { VehicleWithDetails, WorkOrderStatus } from '../../types';

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

function formatLKR(n: number): string {
  return `LKR ${Math.round(n).toLocaleString('en-US')}`;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-0.5">{label}</dt>
      <dd className="text-sm text-gray-800">{value || <span className="text-gray-400">—</span>}</dd>
    </div>
  );
}

// ---- Skeletons -------------------------------------------------------------

function PageSkeleton() {
  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-5xl mx-auto space-y-6">
        <div className="h-4 w-48 bg-gray-100 rounded animate-pulse" />
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          <div className="h-7 w-36 bg-gray-100 rounded animate-pulse" />
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 9 }).map((_, i) => (
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

// ---- Delete dialog ---------------------------------------------------------

function DeleteDialog({
  plate, onConfirm, onCancel, isPending,
}: {
  plate: string; onConfirm: () => void; onCancel: () => void; isPending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} aria-hidden />
      <div className="relative bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
        <h3 className="text-base font-semibold text-gray-900 mb-2">Delete vehicle?</h3>
        <p className="text-sm text-gray-500 mb-6">
          <strong className="font-mono">{plate}</strong> and its service history will be permanently deleted.
          This cannot be undone.
        </p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={isPending}
            className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg
              hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors">
            {isPending ? 'Deleting…' : 'Delete vehicle'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Page ------------------------------------------------------------------

export function VehicleDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [editOpen,   setEditOpen]   = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: vehicle, isLoading, isError } = useQuery<VehicleWithDetails>({
    queryKey: ['vehicle', id],
    queryFn: () => api.get(`/api/vehicles/${id}`).then((r) => r.data.data),
    enabled: !!id,
  });

  const updateMutation = useMutation({
    mutationFn: (body: VehicleFormData) =>
      api.put(`/api/vehicles/${id}`, {
        ...body,
        year:            body.year            ?? null,
        color:           body.color           || null,
        fuel_type:       body.fuel_type        ?? null,
        engine_capacity: body.engine_capacity || null,
        engine_number:   body.engine_number   || null,
        transmission:    body.transmission     ?? null,
        mileage:         body.mileage          ?? null,
        vin:             body.vin             || null,
        ac_system:       body.ac_system        || null,
        notes:           body.notes           || null,
      }).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicle', id] });
      // Also invalidate the customer detail so its vehicle list refreshes
      if (vehicle) {
        queryClient.invalidateQueries({ queryKey: ['customer', vehicle.customer_id] });
      }
      setEditOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/vehicles/${id}`).then((r) => r.data.data),
    onSuccess: () => {
      if (vehicle) {
        queryClient.invalidateQueries({ queryKey: ['customer', vehicle.customer_id] });
      }
      navigate(vehicle ? `/customers/${vehicle.customer_id}` : '/customers');
    },
  });

  if (isLoading) return <PageSkeleton />;

  if (isError || !vehicle) {
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
          <p className="text-sm text-red-500">Vehicle not found.</p>
        </div>
      </AppLayout>
    );
  }

  const editError = updateMutation.error
    ? ((updateMutation.error as { response?: { data?: { error?: { message?: string } } } })
        .response?.data?.error?.message ?? 'Something went wrong')
    : null;

  const totalRevenue = vehicle.work_orders.reduce((sum, wo) => sum + wo.total, 0);

  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-5xl mx-auto space-y-6">

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <button
            onClick={() => navigate('/customers')}
            className="hover:text-gray-700 transition-colors"
          >
            Customers
          </button>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <button
            onClick={() => navigate(`/customers/${vehicle.customer_id}`)}
            className="hover:text-gray-700 transition-colors"
          >
            {vehicle.customer_name}
          </button>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-gray-700 font-mono font-semibold">{vehicle.plate_number}</span>
        </div>

        {/* Vehicle info card */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div>
              <h1 className="text-lg font-mono font-bold text-gray-900 tracking-wide">
                {vehicle.plate_number}
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {vehicle.make} {vehicle.model}
                {vehicle.year && <span className="text-gray-400"> · {vehicle.year}</span>}
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
                onClick={() => navigate(`/work-orders/new?vehicleId=${vehicle.id}`)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white
                  bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                New Work Order
              </button>
              <button
                onClick={() => setDeleteOpen(true)}
                className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"
                title="Delete vehicle"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>

          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 px-6 py-5">
            <InfoRow label="Registration number" value={<span className="font-mono font-semibold">{vehicle.plate_number}</span>} />
            <InfoRow label="Make & Model"        value={`${vehicle.make} ${vehicle.model}`} />
            <InfoRow label="Year"                value={vehicle.year} />
            <InfoRow label="VIN / Chassis number" value={<span className="font-mono text-xs">{vehicle.vin}</span>} />
            <InfoRow label="Engine number"       value={<span className="font-mono text-xs">{vehicle.engine_number}</span>} />
            <InfoRow label="Odometer reading"    value={vehicle.mileage != null ? `${vehicle.mileage.toLocaleString()} km` : null} />
            <InfoRow label="Fuel type"           value={<span className="capitalize">{vehicle.fuel_type}</span>} />
            <InfoRow label="A/C system type"     value={vehicle.ac_system} />
            <InfoRow label="Transmission"        value={vehicle.transmission === 'auto' ? 'Automatic' : vehicle.transmission === 'manual' ? 'Manual' : null} />
            <InfoRow label="Engine capacity"     value={vehicle.engine_capacity} />
            <InfoRow label="Color"               value={vehicle.color} />
            {vehicle.notes && (
              <div className="col-span-2 sm:col-span-3">
                <InfoRow label="Notes" value={vehicle.notes} />
              </div>
            )}
          </dl>

          {/* Owner strip */}
          <div className="flex items-center gap-3 px-6 py-3 border-t border-gray-100 bg-gray-50">
            <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <button
              onClick={() => navigate(`/customers/${vehicle.customer_id}`)}
              className="text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors"
            >
              {vehicle.customer_name}
            </button>
            <span className="text-gray-400">·</span>
            <span className="text-sm text-gray-500">{vehicle.customer_phone}</span>
          </div>
        </div>

        {/* Service history */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Previous Repair History</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {vehicle.work_orders.length} order{vehicle.work_orders.length !== 1 ? 's' : ''}
                {vehicle.work_orders.length > 0 && (
                  <> · <span className="text-gray-600">{formatLKR(totalRevenue)} total</span></>
                )}
              </p>
            </div>
          </div>

          {vehicle.work_orders.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <svg className="w-8 h-8 text-gray-200 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p className="text-sm text-gray-400 mb-3">No service history yet</p>
              <button
                onClick={() => navigate(`/work-orders/new?vehicleId=${vehicle.id}`)}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                Create first work order →
              </button>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Order', 'Date', 'Complaint', 'Status', 'Labour', 'Parts', 'Total'].map((h) => (
                    <th key={h} className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {vehicle.work_orders.map((wo) => (
                  <tr key={wo.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3.5">
                      <span className="text-xs font-mono font-semibold text-gray-700">
                        {wo.order_number}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-500 whitespace-nowrap">
                      {formatDate(wo.created_at)}
                    </td>
                    <td className="px-5 py-3.5 max-w-xs">
                      <p className="text-sm text-gray-700 truncate">
                        {wo.customer_complaint || <span className="text-gray-400 italic">—</span>}
                      </p>
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={wo.status} />
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-600 whitespace-nowrap tabular-nums">
                      {formatLKR(wo.labour_cost)}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-600 whitespace-nowrap tabular-nums">
                      {formatLKR(wo.parts_total)}
                    </td>
                    <td className="px-5 py-3.5 text-sm font-semibold text-gray-900 whitespace-nowrap tabular-nums">
                      {formatLKR(wo.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {vehicle.work_orders.length > 1 && (
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50">
                    <td colSpan={6} className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Total
                    </td>
                    <td className="px-5 py-3 text-sm font-bold text-gray-900 whitespace-nowrap tabular-nums">
                      {formatLKR(totalRevenue)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
      </div>

      {/* Edit vehicle modal */}
      <VehicleForm
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={`Edit · ${vehicle.plate_number}`}
        defaultValues={vehicleToFormData(vehicle)}
        onSubmit={(d) => updateMutation.mutate(d)}
        isPending={updateMutation.isPending}
        error={editError}
      />

      {/* Delete confirmation */}
      {deleteOpen && (
        <DeleteDialog
          plate={vehicle.plate_number}
          onConfirm={() => deleteMutation.mutate()}
          onCancel={() => setDeleteOpen(false)}
          isPending={deleteMutation.isPending}
        />
      )}
    </AppLayout>
  );
}
