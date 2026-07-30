import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '../../components/AppLayout';
import { SendSmsModal } from '../../components/notifications/SendSmsModal';
import type { SmsSendPayload } from '../../components/notifications/SendSmsModal';
import api from '../../lib/api';
import type { NotificationsPage, NotificationStatus, NotificationChannel } from '../../types';

// ---- Helpers ---------------------------------------------------------------

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-LK', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const STATUS_CONFIG: Record<NotificationStatus, { label: string; cls: string }> = {
  pending:   { label: 'Pending',   cls: 'bg-amber-100 text-amber-700' },
  sent:      { label: 'Sent',      cls: 'bg-green-100 text-green-700' },
  failed:    { label: 'Failed',    cls: 'bg-red-100 text-red-600' },
  cancelled: { label: 'Cancelled', cls: 'bg-gray-100 text-gray-600' },
};

function StatusBadge({ status }: { status: NotificationStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

// ---- Pagination --------------------------------------------------------------

function Pagination({ page, total, limit, onChange }: {
  page: number; total: number; limit: number; onChange: (p: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 bg-white text-sm text-gray-500">
      <span>{total} message{total !== 1 ? 's' : ''}</span>
      <div className="flex items-center gap-1">
        <button disabled={page === 1} onClick={() => onChange(page - 1)}
          className="px-2.5 py-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          ← Prev
        </button>
        <span className="px-3">{page} / {totalPages}</span>
        <button disabled={page === totalPages} onClick={() => onChange(page + 1)}
          className="px-2.5 py-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          Next →
        </button>
      </div>
    </div>
  );
}

// ---- Page --------------------------------------------------------------------

export function MessagesPage() {
  const queryClient = useQueryClient();

  const [smsOpen, setSmsOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<NotificationStatus | ''>('');
  const [channel, setChannel] = useState<NotificationChannel | ''>('');
  const limit = 20;

  const { data, isLoading, isError } = useQuery<NotificationsPage>({
    queryKey: ['notifications', { page, status, channel }],
    queryFn: () =>
      api.get('/api/notifications', {
        params: {
          page,
          limit,
          ...(status  ? { status }  : {}),
          ...(channel ? { channel } : {}),
        },
      }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
  });

  const sendSmsMutation = useMutation({
    mutationFn: (body: SmsSendPayload) =>
      api.post('/api/notifications/send/custom', body).then((r) => r.data.data),
    onSuccess: () => {
      setSmsOpen(false);
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const smsError = sendSmsMutation.error
    ? ((sendSmsMutation.error as { response?: { data?: { error?: { message?: string } } } })
        .response?.data?.error?.message ?? 'Something went wrong')
    : null;

  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Messages</h1>
            <p className="text-sm text-gray-400 mt-0.5">Send a quick SMS and review send history</p>
          </div>
          <button
            onClick={() => { sendSmsMutation.reset(); setSmsOpen(true); }}
            className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-white
              bg-blue-600 rounded-lg hover:bg-blue-700 active:bg-blue-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New message
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-4">
          <select
            value={channel}
            onChange={(e) => { setChannel(e.target.value as NotificationChannel | ''); setPage(1); }}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 bg-white outline-none
              focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
            <option value="">All channels</option>
            <option value="sms">SMS</option>
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value as NotificationStatus | ''); setPage(1); }}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 bg-white outline-none
              focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        {/* History table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />
              ))}
            </div>
          ) : isError || !data ? (
            <div className="px-6 py-10 text-center">
              <p className="text-sm text-red-500">Failed to load messages.</p>
            </div>
          ) : data.notifications.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <svg className="w-8 h-8 text-gray-200 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <p className="text-sm text-gray-400">No messages yet</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Recipient', 'Type', 'Channel', 'Message', 'Status', 'Sent'].map((h) => (
                    <th key={h} className="px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.notifications.map((n) => (
                  <tr key={n.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-3.5">
                      <p className="text-sm font-medium text-gray-900">{n.customer_name ?? '—'}</p>
                      <p className="text-xs text-gray-400">{n.customer_phone ?? n.recipient}</p>
                    </td>
                    <td className="px-6 py-3.5 text-sm text-gray-600 whitespace-nowrap">
                      {n.type.replace(/_/g, ' ')}
                    </td>
                    <td className="px-6 py-3.5 text-sm text-gray-600 uppercase">{n.channel}</td>
                    <td className="px-6 py-3.5 max-w-xs">
                      <p className="text-sm text-gray-600 truncate">{n.message}</p>
                      {n.status === 'failed' && n.error_message && (
                        <p className="text-xs text-red-500 truncate mt-0.5">{n.error_message}</p>
                      )}
                    </td>
                    <td className="px-6 py-3.5">
                      <StatusBadge status={n.status} />
                    </td>
                    <td className="px-6 py-3.5 text-sm text-gray-500 whitespace-nowrap">
                      {formatDateTime(n.sent_at ?? n.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {data && (
            <Pagination page={page} total={data.total} limit={limit} onChange={setPage} />
          )}
        </div>
      </div>

      <SendSmsModal
        open={smsOpen}
        onClose={() => setSmsOpen(false)}
        onSubmit={(d) => sendSmsMutation.mutate(d)}
        isPending={sendSmsMutation.isPending}
        error={smsError}
      />
    </AppLayout>
  );
}
