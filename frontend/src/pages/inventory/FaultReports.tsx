import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '../../components/AppLayout';
import api from '../../lib/api';
import type { FaultReport, FaultReportStatus } from '../../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_OPTIONS: { value: FaultReportStatus; label: string }[] = [
  { value: 'open',                 label: 'Open' },
  { value: 'investigating',        label: 'Investigating' },
  { value: 'supplier_contacted',   label: 'Supplier contacted' },
  { value: 'replacement_received', label: 'Replacement received' },
  { value: 'written_off',          label: 'Written off' },
];

const STATUS_STYLE: Record<FaultReportStatus, string> = {
  open:                 'bg-red-100 text-red-700',
  investigating:        'bg-amber-100 text-amber-700',
  supplier_contacted:   'bg-blue-100 text-blue-700',
  replacement_received: 'bg-emerald-100 text-emerald-700',
  written_off:          'bg-gray-100 text-gray-500',
};

const RESOLVED: FaultReportStatus[] = ['replacement_received', 'written_off'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(s: string) {
  return new Date(s).toLocaleDateString('en-LK', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function apiErrMsg(err: unknown) {
  return (err as { response?: { data?: { error?: { message?: string } } } })
    ?.response?.data?.error?.message ?? 'Update failed';
}

// ---------------------------------------------------------------------------
// Inline status updater
// ---------------------------------------------------------------------------

function StatusCell({ report }: { report: FaultReport }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  const mutation = useMutation({
    mutationFn: (status: FaultReportStatus) =>
      api.patch(`/api/fault-reports/${report.id}`, { status }).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fault-reports'] });
      setEditing(false);
    },
  });

  if (editing) {
    return (
      <select
        defaultValue={report.status}
        autoFocus
        onBlur={() => setEditing(false)}
        onChange={(e) => mutation.mutate(e.target.value as FaultReportStatus)}
        disabled={mutation.isPending}
        className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none
          focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      title="Click to change status"
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium
        cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-blue-400 transition-all
        ${STATUS_STYLE[report.status] ?? 'bg-gray-100 text-gray-600'}`}
    >
      {STATUS_OPTIONS.find((o) => o.value === report.status)?.label ?? report.status}
      <svg className="w-2.5 h-2.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function FaultReports() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('all');

  const { data: reports, isLoading } = useQuery<FaultReport[]>({
    queryKey: ['fault-reports', filter],
    queryFn: () =>
      api.get('/api/fault-reports', {
        params: filter !== 'all' ? { status: filter } : {},
      }).then((r) => r.data.data),
  });

  // Resolution note modal
  const [noteTarget, setNoteTarget] = useState<FaultReport | null>(null);
  const [noteText, setNoteText] = useState('');

  const noteMutation = useMutation({
    mutationFn: () =>
      api.patch(`/api/fault-reports/${noteTarget!.id}`, {
        status:          noteTarget!.status,
        resolution_note: noteText,
      }).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fault-reports'] });
      setNoteTarget(null);
    },
  });

  const items = reports ?? [];
  const openCount     = items.filter((r) => !RESOLVED.includes(r.status)).length;
  const resolvedCount = items.filter((r) =>  RESOLVED.includes(r.status)).length;

  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-7xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Part Fault Reports</h1>
            <p className="text-xs text-gray-400 mt-0.5">Track faulty parts and supplier claims</p>
          </div>
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Total reports</p>
            <p className="text-2xl font-bold text-gray-900">{items.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Open</p>
            <p className={`text-2xl font-bold ${openCount > 0 ? 'text-red-600' : 'text-gray-900'}`}>{openCount}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Resolved</p>
            <p className="text-2xl font-bold text-emerald-600">{resolvedCount}</p>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2">
          {(['all', 'open', 'resolved'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors capitalize ${
                filter === f
                  ? 'bg-blue-600 text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {isLoading ? (
            <div className="divide-y divide-gray-100">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-4">
                  <div className="h-4 w-36 bg-gray-100 rounded animate-pulse" />
                  <div className="h-4 w-24 bg-gray-100 rounded animate-pulse" />
                  <div className="h-4 w-20 bg-gray-100 rounded animate-pulse ml-auto" />
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center">
              <svg className="w-10 h-10 text-gray-200 mx-auto mb-3" fill="none" viewBox="0 0 24 24"
                stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-gray-400">
                {filter === 'open' ? 'No open fault reports.' : 'No fault reports found.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    {['Part', 'Work order', 'Vehicle', 'Supplier', 'Phone', 'Invoice ref', 'Fault', 'Status', 'Date', ''].map((h) => (
                      <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((report) => (
                    <tr key={report.id} className="hover:bg-gray-50 transition-colors">
                      {/* Part */}
                      <td className="px-4 py-3 max-w-[160px]">
                        <p className="text-sm font-medium text-gray-900 truncate">{report.part_name}</p>
                        {report.part_number && (
                          <p className="text-xs font-mono text-gray-400">{report.part_number}</p>
                        )}
                      </td>

                      {/* Work order */}
                      <td className="px-4 py-3">
                        <Link
                          to={`/work-orders/${report.work_order_id}`}
                          className="text-sm font-mono font-semibold text-blue-600 hover:text-blue-800"
                        >
                          {report.work_order_number}
                        </Link>
                      </td>

                      {/* Vehicle */}
                      <td className="px-4 py-3">
                        <span className="text-sm font-mono text-gray-700">{report.plate_number}</span>
                      </td>

                      {/* Supplier name */}
                      <td className="px-4 py-3 text-sm text-gray-600 max-w-[140px] truncate">
                        {report.supplier_name || <span className="text-gray-300">—</span>}
                      </td>

                      {/* Supplier phone */}
                      <td className="px-4 py-3">
                        {report.supplier_phone ? (
                          <a
                            href={`tel:${report.supplier_phone}`}
                            className="text-sm text-blue-600 hover:text-blue-800 hover:underline whitespace-nowrap flex items-center gap-1"
                          >
                            <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round"
                                d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                            </svg>
                            {report.supplier_phone}
                          </a>
                        ) : (
                          <span className="text-gray-300 text-sm">—</span>
                        )}
                      </td>

                      {/* Invoice ref */}
                      <td className="px-4 py-3">
                        <span className="text-sm font-mono text-gray-500">
                          {report.supplier_invoice || <span className="text-gray-300">—</span>}
                        </span>
                      </td>

                      {/* Fault description */}
                      <td className="px-4 py-3 max-w-[200px]">
                        <p className="text-sm text-gray-700 line-clamp-2">{report.fault_description}</p>
                        {report.resolution_note && (
                          <p className="text-xs text-emerald-600 mt-0.5 truncate">↳ {report.resolution_note}</p>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <StatusCell report={report} />
                      </td>

                      {/* Date */}
                      <td className="px-4 py-3 text-sm text-gray-400 whitespace-nowrap">
                        {formatDate(report.reported_at)}
                        {report.reported_by_name && (
                          <p className="text-xs text-gray-300">{report.reported_by_name}</p>
                        )}
                      </td>

                      {/* Add/view resolution note */}
                      <td className="px-4 py-3">
                        <button
                          onClick={() => { setNoteTarget(report); setNoteText(report.resolution_note ?? ''); }}
                          className="text-xs text-gray-400 hover:text-gray-700 transition-colors whitespace-nowrap"
                          title="Add resolution note"
                        >
                          {report.resolution_note ? 'Edit note' : 'Add note'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Resolution note modal */}
      {noteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setNoteTarget(null)} aria-hidden />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-4">
            <h3 className="text-base font-semibold text-gray-900">Resolution note</h3>
            <p className="text-xs text-gray-500">
              <span className="font-medium">{noteTarget.part_name}</span> · {noteTarget.work_order_number}
            </p>
            <textarea
              rows={4}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              autoFocus
              placeholder="e.g. Supplier agreed to replace, awaiting delivery…"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {noteMutation.error && (
              <p className="text-sm text-red-500">{apiErrMsg(noteMutation.error)}</p>
            )}
            <div className="flex justify-end gap-3">
              <button onClick={() => setNoteTarget(null)}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
                Cancel
              </button>
              <button
                onClick={() => noteMutation.mutate()}
                disabled={noteMutation.isPending}
                className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg
                  hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {noteMutation.isPending ? 'Saving…' : 'Save note'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
