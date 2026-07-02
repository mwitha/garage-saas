import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import api from '../../lib/api';
import type { CustomerListItem, Vehicle, User } from '../../types';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const schema = z.object({
  vehicle_id:         z.string().uuid('Select a vehicle'),
  assigned_to:        z.string().uuid().nullable().optional(),
  customer_complaint: z.string().optional(),
  mileage_in:         z.preprocess(
    (v) => (v === '' || v == null ? undefined : Number(v)),
    z.number().int().nonnegative().optional(),
  ),
  labour_cost:        z.preprocess(
    (v) => (v === '' || v == null ? 0 : Number(v)),
    z.number().nonnegative().default(0),
  ),
  promised_date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
});

export type WorkOrderFormData = z.infer<typeof schema>;

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

type Step = 0 | 1 | 2 | 3;

const STEP_LABELS = ['Customer', 'Vehicle', 'Details', 'Assign'];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StepIndicator({ current, total }: { current: Step; total: number }) {
  return (
    <div className="flex items-center gap-0 mb-6">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className="flex items-center">
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition-colors ${
              i < current
                ? 'bg-blue-600 border-blue-600 text-white'
                : i === current
                ? 'bg-white border-blue-600 text-blue-600'
                : 'bg-white border-gray-200 text-gray-400'
            }`}
          >
            {i < current ? (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              i + 1
            )}
          </div>
          {i < total - 1 && (
            <div className={`h-0.5 w-10 transition-colors ${i < current ? 'bg-blue-600' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
      <span className="ml-3 text-xs text-gray-400 font-medium">{STEP_LABELS[current]}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface Props {
  open: boolean;
  onClose: () => void;
}

export function WorkOrderForm({ open, onClose }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const prefilledVehicleId = searchParams.get('vehicleId');

  const [step, setStep] = useState<Step>(prefilledVehicleId ? 2 : 0);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<WorkOrderFormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: { vehicle_id: prefilledVehicleId ?? '', labour_cost: 0 },
  });

  const watchedVehicleId = watch('vehicle_id');

  // When opened with a vehicleId, we need to fetch that vehicle first to get customer
  const { data: prefilledVehicle } = useQuery<Vehicle>({
    queryKey: ['vehicle-bare', prefilledVehicleId],
    queryFn: () => api.get(`/api/vehicles/${prefilledVehicleId}`).then((r) => r.data.data),
    enabled: !!prefilledVehicleId && open,
  });

  useEffect(() => {
    if (prefilledVehicle) {
      setSelectedCustomerId(prefilledVehicle.customer_id);
      setValue('vehicle_id', prefilledVehicle.id);
    }
  }, [prefilledVehicle, setValue]);

  const { data: customersData } = useQuery<{ customers: CustomerListItem[] }>({
    queryKey: ['customers-search', customerSearch],
    queryFn: () =>
      api.get('/api/customers', { params: { search: customerSearch, limit: 20 } }).then((r) => r.data.data),
    enabled: open && step === 0,
  });

  const { data: vehiclesData, isPending: vehiclesLoading } = useQuery<Vehicle[]>({
    queryKey: ['customer-vehicles', selectedCustomerId],
    queryFn: () =>
      api.get(`/api/customers/${selectedCustomerId}/vehicles`).then((r) => r.data.data.vehicles),
    enabled: !!selectedCustomerId && step === 1,
  });

  const { data: users } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: () => api.get('/api/users').then((r) => r.data.data),
    enabled: open && step === 3,
  });

  const createMutation = useMutation({
    mutationFn: (data: WorkOrderFormData) => api.post('/api/work-orders', data).then((r) => r.data.data),
    onSuccess: (wo) => {
      queryClient.invalidateQueries({ queryKey: ['work-orders'] });
      onClose();
      navigate(`/work-orders/${wo.id}`);
    },
  });

  const onSubmit = handleSubmit((data) => {
    createMutation.mutate({
      ...data,
      assigned_to:   data.assigned_to  || null,
      promised_date: data.promised_date || undefined,
    } as WorkOrderFormData);
  });

  if (!open) return null;

  const customers = customersData?.customers ?? [];
  const vehicles  = vehiclesData ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">New Work Order</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 rounded transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={onSubmit}>
          <div className="px-6 py-5">
            <StepIndicator current={step} total={STEP_LABELS.length} />

            {/* Step 0: Select Customer */}
            {step === 0 && (
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Search customer by name or phone…"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {customers.length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-8">No customers found</p>
                  )}
                  {customers.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => { setSelectedCustomerId(c.id); setStep(1); }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg
                        hover:bg-blue-50 text-left transition-colors"
                    >
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-semibold text-blue-600">
                          {c.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{c.name}</p>
                        <p className="text-xs text-gray-400">{c.phone}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Step 1: Select Vehicle */}
            {step === 1 && (
              <div className="space-y-2">
                {vehiclesLoading ? (
                  [1, 2].map((i) => (
                    <div key={i} className="h-14 bg-gray-100 rounded-lg animate-pulse" />
                  ))
                ) : vehicles.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">No vehicles for this customer</p>
                ) : null}
                {vehicles.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => { setValue('vehicle_id', v.id); setStep(2); }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors text-left ${
                      watchedVehicleId === v.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                    }`}
                  >
                    <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d="M8 7h.01M12 7h.01M16 7h.01M3 12h18M5 21h14a2 2 0 002-2v-6l-2-4H5l-2 4v6a2 2 0 002 2z" />
                    </svg>
                    <div className="min-w-0">
                      <p className="text-sm font-mono font-bold text-gray-900">{v.plate_number}</p>
                      <p className="text-xs text-gray-400">
                        {v.make} {v.model}{v.year ? ` · ${v.year}` : ''}
                      </p>
                    </div>
                  </button>
                ))}
                <input type="hidden" {...register('vehicle_id')} />
                {errors.vehicle_id && (
                  <p className="text-xs text-red-500">{errors.vehicle_id.message}</p>
                )}
              </div>
            )}

            {/* Step 2: Details */}
            {step === 2 && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Customer complaint</label>
                  <textarea
                    {...register('customer_complaint')}
                    rows={3}
                    placeholder="Describe what the customer reported…"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none
                      focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Mileage in (km)</label>
                  <input
                    type="number"
                    {...register('mileage_in')}
                    placeholder="e.g. 45000"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                      focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Labour cost (LKR)</label>
                  <input
                    type="number"
                    step="0.01"
                    {...register('labour_cost')}
                    defaultValue={0}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                      focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
            )}

            {/* Step 3: Assign + date */}
            {step === 3 && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Assign technician</label>
                  <select
                    {...register('assigned_to')}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                      focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                  >
                    <option value="">Unassigned</option>
                    {(users ?? []).map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
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

                {createMutation.error && (
                  <p className="text-xs text-red-500">
                    {(createMutation.error as { response?: { data?: { error?: { message?: string } } } })
                      .response?.data?.error?.message ?? 'Something went wrong'}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 pb-5">
            {step > 0 ? (
              <button
                type="button"
                onClick={() => setStep((s) => (s - 1) as Step)}
                className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>
            ) : (
              <span />
            )}

            {step < 3 ? (
              <button
                type="button"
                onClick={() => {
                  if (step === 1 && !watchedVehicleId) return;
                  setStep((s) => (s + 1) as Step);
                }}
                disabled={step === 1 && !watchedVehicleId}
                className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg
                  hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            ) : (
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg
                  hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {createMutation.isPending ? 'Creating…' : 'Create Work Order'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
