import { useState, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDebounce } from '../../hooks/useDebounce';
import { AppLayout } from '../../components/AppLayout';
import api from '../../lib/api';
import type { InventoryItem } from '../../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IssueNoteSummary {
  id: string;
  issue_number: string;
  issued_to: string;
  reason: string | null;
  issued_at: string;
  status: 'draft' | 'posted';
  item_count: number;
  created_at: string;
  posted_at: string | null;
}

interface IssueNoteItem {
  id?: string;
  inventory_item_id: string;
  item_name: string;
  part_number: string | null;
  unit: string;
  quantity: number;
}

interface IssueNoteDetail {
  id: string;
  issue_number: string;
  issued_to: string;
  reason: string | null;
  issued_at: string;
  status: 'draft' | 'posted';
  posted_at: string | null;
  items: IssueNoteItem[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
      <div className={`relative bg-white rounded-2xl shadow-xl w-full my-8 ${wide ? 'max-w-2xl' : 'max-w-md'} p-6`}>
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
// Inventory item search (issue context — shows current stock so overdrawing is obvious)
// ---------------------------------------------------------------------------

function ItemSearchDropdown({ onSelect }: { onSelect: (item: InventoryItem) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen]   = useState(false);
  const containerRef      = useRef<HTMLDivElement>(null);
  const debounced         = useDebounce(query, 300);

  const { data, isFetching } = useQuery<{ items: InventoryItem[] }>({
    queryKey: ['issue-note-item-search', debounced],
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
                  {item.part_number ? `${item.part_number} · ` : ''}{item.unit}
                </p>
              </div>
              <span className={`text-xs ml-3 ${item.quantity <= 0 ? 'text-red-500 font-medium' : 'text-gray-500'}`}>
                stock: {item.quantity}
              </span>
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
// Issue Note form (create / edit draft)
// ---------------------------------------------------------------------------

interface LineItem {
  inventory_item_id: string;
  item_name: string;
  part_number: string | null;
  unit: string;
  quantity: number;
}

function IssueNoteForm({ note, onClose, onSaved }: {
  note?: IssueNoteDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!note;

  const [issuedTo, setIssuedTo] = useState(note?.issued_to ?? '');
  const [reason, setReason]     = useState(note?.reason ?? '');
  const [issuedAt, setIssuedAt] = useState(
    note?.issued_at ? note.issued_at.slice(0, 10) : new Date().toISOString().slice(0, 10),
  );
  const [lines, setLines] = useState<LineItem[]>(
    note?.items.map((i) => ({
      inventory_item_id: i.inventory_item_id,
      item_name: i.item_name,
      part_number: i.part_number,
      unit: i.unit,
      quantity: i.quantity,
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
      }]);
    }
  }

  function removeItem(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateQuantity(idx: number, value: number) {
    setLines((prev) => prev.map((l, i) => i === idx ? { ...l, quantity: value } : l));
  }

  function buildPayload() {
    return {
      issued_to: issuedTo,
      reason: reason || undefined,
      issued_at: issuedAt,
      items: lines.map((l) => ({
        inventory_item_id: l.inventory_item_id,
        quantity: l.quantity,
      })),
    };
  }

  function validate(): string | null {
    if (!issuedTo.trim()) return 'Issued to is required';
    if (lines.length === 0) return 'Add at least one item';
    return null;
  }

  async function handleSave() {
    const v = validate();
    if (v) { setError(v); return; }
    setError(null);
    setSaving(true);
    try {
      if (isEdit) {
        await api.patch(`/api/issue-notes/${note!.id}`, buildPayload());
      } else {
        await api.post('/api/issue-notes', buildPayload());
      }
      qc.invalidateQueries({ queryKey: ['issue-notes'] });
      onSaved();
    } catch (err) {
      setError(apiErr(err));
    } finally {
      setSaving(false);
    }
  }

  async function handlePost() {
    const v = validate();
    if (v) { setError(v); return; }
    setError(null);
    setPosting(true);
    try {
      let targetId = note?.id;
      if (!targetId) {
        const res = await api.post('/api/issue-notes', buildPayload());
        targetId = res.data.data.id;
      } else {
        await api.patch(`/api/issue-notes/${note!.id}`, buildPayload());
      }
      await api.post(`/api/issue-notes/${targetId}/post`);
      qc.invalidateQueries({ queryKey: ['issue-notes'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      onSaved();
    } catch (err) {
      setError(apiErr(err));
    } finally {
      setPosting(false);
    }
  }

  return (
    <ModalShell title={isEdit ? `Edit Issue Note ${note!.issue_number}` : 'New Issue Note'} onClose={onClose} wide>
      <div className="space-y-5">

        {/* Header fields */}
        <div className="grid grid-cols-2 gap-4">
          <FieldWrap label="Issued to *">
            <input
              value={issuedTo}
              onChange={(e) => setIssuedTo(e.target.value)}
              placeholder="e.g. Warranty replacement - Kamal Perera"
              autoFocus
              className={inputCls()}
            />
          </FieldWrap>
          <FieldWrap label="Date">
            <input
              type="date"
              value={issuedAt}
              onChange={(e) => setIssuedAt(e.target.value)}
              className={inputCls()}
            />
          </FieldWrap>
          <div className="col-span-2">
            <FieldWrap label="Reason / notes">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Optional — e.g. Faulty unit replaced under warranty"
                className={inputCls()}
              />
            </FieldWrap>
          </div>
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
                    <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider w-28">Qty</th>
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
                          onChange={(e) => updateQuantity(idx, parseFloat(e.target.value) || 0)}
                          className="w-full text-center px-2 py-1 text-sm border border-gray-200
                            rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
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
                bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"
                stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              {posting ? 'Posting…' : 'Post (issue stock)'}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Issue Note detail view modal
// ---------------------------------------------------------------------------

function IssueNoteDetailModal({ noteId, onClose }: { noteId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [posting, setPosting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: note, isLoading } = useQuery<IssueNoteDetail>({
    queryKey: ['issue-note', noteId],
    queryFn: () => api.get(`/api/issue-notes/${noteId}`).then((r) => r.data.data),
  });

  async function handlePost() {
    setError(null);
    setPosting(true);
    try {
      await api.post(`/api/issue-notes/${noteId}/post`);
      qc.invalidateQueries({ queryKey: ['issue-notes'] });
      qc.invalidateQueries({ queryKey: ['issue-note', noteId] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
    } catch (err) {
      setError(apiErr(err));
    } finally {
      setPosting(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this draft issue note?')) return;
    setDeleting(true);
    try {
      await api.delete(`/api/issue-notes/${noteId}`);
      qc.invalidateQueries({ queryKey: ['issue-notes'] });
      onClose();
    } catch (err) {
      setError(apiErr(err));
      setDeleting(false);
    }
  }

  if (editing && note) {
    return (
      <IssueNoteForm
        note={note}
        onClose={() => setEditing(false)}
        onSaved={() => { setEditing(false); qc.invalidateQueries({ queryKey: ['issue-note', noteId] }); }}
      />
    );
  }

  return (
    <ModalShell title={note ? `Issue Note: ${note.issue_number}` : 'Issue Note'} onClose={onClose} wide>
      {isLoading || !note ? (
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
              note.status === 'posted' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
            }`}>
              {note.status === 'posted' ? 'Posted' : 'Draft'}
            </span>
            {note.posted_at && (
              <span className="text-xs text-gray-400">Posted {fmtDate(note.posted_at)}</span>
            )}
          </div>

          {/* Meta */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Issued To</p>
              <p className="font-medium text-gray-900">{note.issued_to}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Date</p>
              <p className="font-medium text-gray-900">{fmtDate(note.issued_at)}</p>
            </div>
          </div>

          {/* Items table */}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Item</th>
                  <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider w-24">Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {note.items.map((item, i) => (
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {note.reason && (
            <p className="text-sm text-gray-500 bg-gray-50 rounded-lg px-4 py-3">{note.reason}</p>
          )}

          {error && (
            <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}

          {note.status === 'draft' && (
            <div className="flex items-center justify-between border-t border-gray-100 pt-4">
              <div className="flex items-center gap-4">
                <button onClick={handleDelete} disabled={deleting}
                  className="text-xs font-medium text-red-500 hover:text-red-700 transition-colors disabled:opacity-60">
                  {deleting ? 'Deleting…' : 'Delete draft'}
                </button>
                <button onClick={() => setEditing(true)}
                  className="text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors">
                  Edit
                </button>
              </div>
              <button onClick={handlePost} disabled={posting}
                className="flex items-center gap-1.5 px-5 py-2 text-sm font-semibold text-white
                  bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"
                  stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {posting ? 'Posting…' : 'Post (issue stock)'}
              </button>
            </div>
          )}
        </div>
      )}
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function IssueNotesPage() {
  const [newOpen, setNewOpen]           = useState(false);
  const [viewId, setViewId]             = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | 'draft' | 'posted'>('');

  const { data, isLoading } = useQuery<{ issueNotes: IssueNoteSummary[]; total: number }>({
    queryKey: ['issue-notes', statusFilter],
    queryFn: () =>
      api.get('/api/issue-notes', { params: statusFilter ? { status: statusFilter } : {} })
        .then((r) => r.data.data),
  });

  const notes = data?.issueNotes ?? [];

  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-5xl mx-auto space-y-6">

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Issue Notes</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Issue inventory items out (warranty, internal use, etc.) without creating an invoice
            </p>
          </div>
          <button onClick={() => setNewOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white
              bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Issue Note
          </button>
        </div>

        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
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

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-white rounded-xl border border-gray-200 animate-pulse" />)}
          </div>
        ) : notes.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 flex items-center justify-center h-40 text-sm text-gray-400">
            No issue notes yet — click "New Issue Note" to issue stock without invoicing
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Issue #</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Issued To</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Date</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center">Items</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider w-24">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {notes.map((n) => (
                  <tr key={n.id}
                    onClick={() => setViewId(n.id)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors">
                    <td className="px-5 py-3.5">
                      <span className="text-sm font-mono font-bold text-gray-900">{n.issue_number}</span>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-700 max-w-[280px] truncate">{n.issued_to}</td>
                    <td className="px-5 py-3.5 text-sm text-gray-600">{fmtDate(n.issued_at)}</td>
                    <td className="px-5 py-3.5 text-center">
                      <span className="text-sm font-semibold text-gray-700">{n.item_count}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                        n.status === 'posted'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}>
                        {n.status === 'posted' ? 'Posted' : 'Draft'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {newOpen && (
          <IssueNoteForm
            onClose={() => setNewOpen(false)}
            onSaved={() => setNewOpen(false)}
          />
        )}
        {viewId && <IssueNoteDetailModal noteId={viewId} onClose={() => setViewId(null)} />}
      </div>
    </AppLayout>
  );
}
