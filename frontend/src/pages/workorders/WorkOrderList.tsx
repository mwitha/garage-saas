import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '../../components/AppLayout';
import { WorkOrderForm } from '../../components/workorders/WorkOrderForm';
import api from '../../lib/api';
import type { WorkOrderSummary, WorkOrderStatus, WorkOrdersPage } from '../../types';

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<WorkOrderStatus, { label: string; col: string; dot: string }> = {
  received:      { label: 'Received',      col: 'bg-gray-50 border-gray-200',     dot: 'bg-gray-400' },
  diagnosing:    { label: 'Diagnosing',    col: 'bg-amber-50 border-amber-200',   dot: 'bg-amber-400' },
  waiting_parts: { label: 'Waiting Parts', col: 'bg-orange-50 border-orange-200', dot: 'bg-orange-400' },
  in_progress:   { label: 'In Progress',   col: 'bg-blue-50 border-blue-200',     dot: 'bg-blue-500' },
  quality_check: { label: 'Quality Check', col: 'bg-indigo-50 border-indigo-200', dot: 'bg-indigo-500' },
  ready:         { label: 'Ready',         col: 'bg-green-50 border-green-200',   dot: 'bg-green-500' },
  delivered:     { label: 'Delivered',     col: 'bg-purple-50 border-purple-200', dot: 'bg-purple-500' },
  cancelled:     { label: 'Cancelled',     col: 'bg-red-50 border-red-200',       dot: 'bg-red-400' },
};

const BOARD_STATUSES: WorkOrderStatus[] = [
  'received', 'diagnosing', 'waiting_parts', 'in_progress',
  'quality_check', 'ready', 'delivered', 'cancelled',
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

const BADGE_CLS: Record<WorkOrderStatus, string> = {
  received:      'bg-gray-100 text-gray-600',
  diagnosing:    'bg-amber-100 text-amber-700',
  waiting_parts: 'bg-orange-100 text-orange-700',
  in_progress:   'bg-blue-100 text-blue-700',
  quality_check: 'bg-indigo-100 text-indigo-700',
  ready:         'bg-green-100 text-green-700',
  delivered:     'bg-purple-100 text-purple-700',
  cancelled:     'bg-red-100 text-red-600',
};

// ---------------------------------------------------------------------------
// WO Card
// ---------------------------------------------------------------------------

function WOCard({
  wo,
  onClick,
  onStatusChange,
}: {
  wo: WorkOrderSummary;
  onClick: () => void;
  onStatusChange: (id: string, status: WorkOrderStatus) => void;
}) {
  const allowed = TRANSITIONS[wo.status];

  return (
    <div
      className="bg-white rounded-xl border border-gray-200 p-3.5 cursor-pointer
        hover:shadow-sm hover:border-blue-300 transition-all"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-xs font-mono font-bold text-gray-700">{wo.order_number}</span>
        {allowed.length > 0 && (
          <select
            value={wo.status}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              e.stopPropagation();
              onStatusChange(wo.id, e.target.value as WorkOrderStatus);
            }}
            className={`text-xs font-medium px-1.5 py-0.5 rounded-full border-0 cursor-pointer
              appearance-none text-center ${BADGE_CLS[wo.status]}`}
            style={{ backgroundImage: 'none' }}
          >
            <option value={wo.status} disabled>{STATUS_CONFIG[wo.status].label}</option>
            {allowed.map((s) => (
              <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
            ))}
          </select>
        )}
        {allowed.length === 0 && (
          <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${BADGE_CLS[wo.status]}`}>
            {STATUS_CONFIG[wo.status].label}
          </span>
        )}
      </div>

      <p className="text-xs font-mono font-semibold text-gray-900 mb-0.5">{wo.plate_number}</p>
      <p className="text-xs text-gray-500 mb-1.5 truncate">{wo.customer_name}</p>

      {wo.customer_complaint && (
        <p className="text-xs text-gray-400 line-clamp-2 leading-relaxed mb-2">
          {wo.customer_complaint}
        </p>
      )}

      {wo.assigned_to_name && (
        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-gray-100">
          <div className="w-4 h-4 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
            <span className="text-[9px] font-semibold text-blue-600">
              {wo.assigned_to_name.charAt(0).toUpperCase()}
            </span>
          </div>
          <span className="text-xs text-gray-500 truncate">{wo.assigned_to_name}</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function WorkOrderList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery<WorkOrdersPage>({
    queryKey: ['work-orders', search],
    queryFn: () =>
      api.get('/api/work-orders', { params: { search: search || undefined, limit: 100 } })
        .then((r) => r.data.data),
    refetchInterval: 30_000,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: WorkOrderStatus }) =>
      api.patch(`/api/work-orders/${id}/status`, { status }).then((r) => r.data.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['work-orders'] }),
  });

  const allOrders = data?.work_orders ?? [];

  const grouped = BOARD_STATUSES.reduce<Record<WorkOrderStatus, WorkOrderSummary[]>>(
    (acc, s) => ({ ...acc, [s]: allOrders.filter((wo) => wo.status === s) }),
    {} as Record<WorkOrderStatus, WorkOrderSummary[]>,
  );

  return (
    <AppLayout>
      <div className="px-6 py-6 flex flex-col h-full">

        {/* Header */}
        <div className="flex items-center justify-between mb-5 flex-shrink-0">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Work Orders</h1>
            {data && (
              <p className="text-xs text-gray-400 mt-0.5">
                {data.total} order{data.total !== 1 ? 's' : ''} total
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" />
              </svg>
              <input
                type="text"
                placeholder="Search orders…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg w-52
                  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <button
              onClick={() => setFormOpen(true)}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold text-white
                bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              New Order
            </button>
          </div>
        </div>

        {/* Kanban board */}
        {isLoading ? (
          <div className="flex gap-4 overflow-x-auto pb-4">
            {BOARD_STATUSES.slice(0, 4).map((s) => (
              <div key={s} className="flex-shrink-0 w-60 space-y-3">
                <div className="h-5 w-24 bg-gray-100 rounded animate-pulse" />
                {[1, 2].map((i) => (
                  <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-4 flex-1">
            {BOARD_STATUSES.map((status) => {
              const cards = grouped[status];
              const cfg = STATUS_CONFIG[status];
              return (
                <div key={status} className="flex-shrink-0 w-60 flex flex-col">
                  <div className="flex items-center gap-2 mb-2.5">
                    <div className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                    <span className="text-xs font-semibold text-gray-700">{cfg.label}</span>
                    <span className="ml-auto text-xs text-gray-400 tabular-nums">{cards.length}</span>
                  </div>
                  <div className={`flex-1 rounded-xl border p-2 space-y-2 min-h-32 ${cfg.col}`}>
                    {cards.length === 0 && (
                      <div className="flex items-center justify-center h-20">
                        <p className="text-xs text-gray-400">Empty</p>
                      </div>
                    )}
                    {cards.map((wo) => (
                      <WOCard
                        key={wo.id}
                        wo={wo}
                        onClick={() => navigate(`/work-orders/${wo.id}`)}
                        onStatusChange={(id, s) => statusMutation.mutate({ id, status: s })}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <WorkOrderForm open={formOpen} onClose={() => setFormOpen(false)} />
    </AppLayout>
  );
}
