import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import type { TooltipContentProps } from 'recharts';
import { AppLayout } from '../../components/AppLayout';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { SECTIONS } from '../../lib/permissions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StaffRole = 'admin' | 'service_advisor' | 'technician';

interface Employee {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  phone: string | null;
  active: boolean;
  total_jobs: number;
  active_jobs: number;
  completed_jobs: number;
  lifetime_revenue: number;
  paid_invoices: number;
}

interface ContribRow {
  id: string;
  name: string;
  role: StaffRole;
  phone: string | null;
  active: boolean;
  total_jobs: number;
  completed_jobs: number;
  active_jobs: number;
  paid_revenue: number;
  paid_invoices: number;
  avg_invoice_value: number;
}

interface ContribData {
  rows: ContribRow[];
  meta: { from: string; to: string; totalRevenue: number };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROLE_META: Record<StaffRole, { label: string; cls: string }> = {
  technician:      { label: 'Technician',      cls: 'bg-blue-100 text-blue-700' },
  service_advisor: { label: 'Service Advisor', cls: 'bg-purple-100 text-purple-700' },
  admin:           { label: 'Admin',           cls: 'bg-orange-100 text-orange-700' },
};

const ROLE_OPTIONS: { value: StaffRole; label: string }[] = [
  { value: 'technician',      label: 'Technician' },
  { value: 'service_advisor', label: 'Service Advisor' },
  { value: 'admin',           label: 'Admin' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number) {
  if (n >= 1_000_000) return `LKR ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `LKR ${(n / 1_000).toFixed(0)}K`;
  return `LKR ${Math.round(n).toLocaleString('en-US')}`;
}
function fmtFull(n: number) {
  return `LKR ${Math.round(n).toLocaleString('en-US')}`;
}

function apiErr(err: unknown): string {
  return (err as { response?: { data?: { error?: { message?: string } } } })
    ?.response?.data?.error?.message ?? 'Something went wrong';
}

function defaultFrom() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() - 2, 1).toISOString().slice(0, 10);
}
function defaultTo() {
  return new Date().toISOString().slice(0, 10);
}

function initials(name: string) {
  return name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
}

const AVATAR_COLOURS = [
  'bg-blue-500', 'bg-purple-500', 'bg-emerald-500', 'bg-orange-500',
  'bg-pink-500', 'bg-indigo-500', 'bg-teal-500', 'bg-rose-500',
];
function avatarColour(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length];
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function RoleBadge({ role }: { role: StaffRole }) {
  const m = ROLE_META[role] ?? { label: role, cls: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${m.cls}`}>
      {m.label}
    </span>
  );
}

function StatPill({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="text-center">
      <p className={`text-lg font-bold ${accent ? 'text-blue-600' : 'text-gray-900'}`}>{value}</p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add / Edit modal
// ---------------------------------------------------------------------------

const createSchema = z.object({
  name:  z.string().min(1, 'Name is required'),
  email: z.string().email('Valid email required'),
  role:  z.enum(['admin', 'service_advisor', 'technician'] as const),
  phone: z.string().optional(),
});
type CreateForm = z.infer<typeof createSchema>;

const editSchema = z.object({
  name:  z.string().min(1, 'Name is required'),
  role:  z.enum(['admin', 'service_advisor', 'technician'] as const),
  phone: z.string().optional(),
});
type EditForm = z.infer<typeof editSchema>;

const inputCls = (err?: string) =>
  `w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2
   focus:ring-blue-500 ${err ? 'border-red-300' : 'border-gray-200'}`;

function FieldWrap({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {children}
      {error && <p className="text-xs text-red-500 mt-0.5">{error}</p>}
    </div>
  );
}

function AddModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [tempPwd, setTempPwd] = useState<string | null>(null);
  const [empName, setEmpName] = useState('');

  const { register, handleSubmit, formState: { errors } } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { role: 'technician' },
  });

  const mutation = useMutation({
    mutationFn: (data: CreateForm) =>
      api.post('/api/employees', data).then((r) => r.data.data),
    onSuccess: (res: { employee: Employee; temporaryPassword: string }) => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      setTempPwd(res.temporaryPassword);
      setEmpName(res.employee.name);
    },
  });

  if (tempPwd) {
    return (
      <ModalShell title="Member Added" onClose={onClose}>
        <div className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <p className="text-sm text-green-700 font-medium mb-1">{empName} has been added.</p>
            <p className="text-xs text-green-600">Share this temporary password — it won't be shown again.</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 mb-1">Temporary Password</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-gray-100 px-3 py-2 rounded-lg text-sm font-mono font-bold tracking-widest text-gray-900">
                {tempPwd}
              </code>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(tempPwd)}
                className="p-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                title="Copy"
              >
                <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={onClose}
              className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors">
              Done
            </button>
          </div>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell title="Add Team Member" onClose={onClose}>
      <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
        <FieldWrap label="Full name *" error={errors.name?.message}>
          <input {...register('name')} autoFocus className={inputCls(errors.name?.message)} />
        </FieldWrap>
        <FieldWrap label="Email *" error={errors.email?.message}>
          <input {...register('email')} type="email" className={inputCls(errors.email?.message)} />
        </FieldWrap>
        <div className="grid grid-cols-2 gap-3">
          <FieldWrap label="Role *" error={errors.role?.message}>
            <select {...register('role')} className={inputCls(errors.role?.message)}>
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </FieldWrap>
          <FieldWrap label="Phone" error={errors.phone?.message}>
            <input {...register('phone')} placeholder="e.g. 0771234567" className={inputCls()} />
          </FieldWrap>
        </div>
        {mutation.isError && (
          <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {apiErr(mutation.error)}
          </p>
        )}
        <div className="flex justify-end gap-3 pt-1">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={mutation.isPending}
            className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg
              hover:bg-blue-700 disabled:opacity-60 transition-colors">
            {mutation.isPending ? 'Adding…' : 'Add Member'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function EditModal({ emp, onClose }: { emp: Employee; onClose: () => void }) {
  const qc = useQueryClient();
  const [resetPwd, setResetPwd] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const { register, handleSubmit, formState: { errors, isDirty } } = useForm<EditForm>({
    resolver: zodResolver(editSchema),
    defaultValues: { name: emp.name, role: emp.role, phone: emp.phone ?? '' },
  });

  const updateMutation = useMutation({
    mutationFn: (data: EditForm) =>
      api.patch(`/api/employees/${emp.id}`, data).then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      onClose();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: () =>
      api.patch(`/api/employees/${emp.id}`, { active: !emp.active }).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employees'] }),
  });

  async function handleResetPwd() {
    setResetting(true);
    try {
      const res = await api.post(`/api/employees/${emp.id}/reset-password`);
      setResetPwd(res.data.data.temporaryPassword);
    } finally {
      setResetting(false);
    }
  }

  return (
    <ModalShell title="Edit Team Member" onClose={onClose}>
      <form onSubmit={handleSubmit((d) => updateMutation.mutate(d))} className="space-y-4">
        <FieldWrap label="Full name *" error={errors.name?.message}>
          <input {...register('name')} autoFocus className={inputCls(errors.name?.message)} />
        </FieldWrap>
        <div className="grid grid-cols-2 gap-3">
          <FieldWrap label="Role *" error={errors.role?.message}>
            <select {...register('role')} className={inputCls(errors.role?.message)}>
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </FieldWrap>
          <FieldWrap label="Phone">
            <input {...register('phone')} placeholder="e.g. 0771234567" className={inputCls()} />
          </FieldWrap>
        </div>

        {/* Reset password */}
        <div className="border-t border-gray-100 pt-3">
          {resetPwd ? (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
              <p className="text-xs font-medium text-amber-700">New temporary password (copy it now)</p>
              <code className="block bg-white px-2 py-1 rounded border border-amber-200 text-sm font-mono font-bold tracking-widest">
                {resetPwd}
              </code>
            </div>
          ) : (
            <button type="button" onClick={handleResetPwd} disabled={resetting}
              className="text-xs font-medium text-amber-600 hover:text-amber-700 transition-colors disabled:opacity-60">
              {resetting ? 'Generating…' : 'Reset password'}
            </button>
          )}
        </div>

        {updateMutation.isError && (
          <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {apiErr(updateMutation.error)}
          </p>
        )}

        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={() => toggleMutation.mutate()}
            disabled={toggleMutation.isPending}
            className={`text-xs font-medium transition-colors disabled:opacity-60 ${
              emp.active
                ? 'text-red-500 hover:text-red-700'
                : 'text-emerald-600 hover:text-emerald-700'
            }`}
          >
            {emp.active ? 'Deactivate member' : 'Reactivate member'}
          </button>
          <div className="flex gap-3">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={updateMutation.isPending || !isDirty}
              className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg
                hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {updateMutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </ModalShell>
  );
}

function ModalShell({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
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
// Team tab
// ---------------------------------------------------------------------------

function TeamTab() {
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editEmp, setEditEmp] = useState<Employee | null>(null);

  const { data: employees = [], isLoading } = useQuery<Employee[]>({
    queryKey: ['employees'],
    queryFn: () => api.get('/api/employees').then((r) => r.data.data),
  });

  const filtered = employees.filter((e) =>
    !search || e.name.toLowerCase().includes(search.toLowerCase()) ||
    e.email.toLowerCase().includes(search.toLowerCase()) ||
    (e.role as string).includes(search.toLowerCase()),
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-white rounded-xl border border-gray-200 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search team…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none
              focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white
            bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add Member
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 flex items-center justify-center h-40 text-sm text-gray-400">
          {search ? 'No team members match your search' : 'No team members yet — add one above'}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Member</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Role</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center">Jobs</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center">Active</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Revenue</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((emp) => (
                <tr key={emp.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-bold ${avatarColour(emp.id)} ${!emp.active ? 'opacity-40' : ''}`}>
                        {initials(emp.name)}
                      </div>
                      <div>
                        <p className={`text-sm font-medium ${emp.active ? 'text-gray-900' : 'text-gray-400'}`}>
                          {emp.name}
                        </p>
                        <p className="text-xs text-gray-400">{emp.email}</p>
                      </div>
                      {!emp.active && (
                        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                          Inactive
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <RoleBadge role={emp.role} />
                  </td>
                  <td className="px-5 py-3.5 text-center">
                    <span className="text-sm font-semibold text-gray-900">{emp.total_jobs}</span>
                    <span className="text-xs text-gray-400 ml-1">total</span>
                  </td>
                  <td className="px-5 py-3.5 text-center">
                    <span className={`text-sm font-semibold ${emp.active_jobs > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                      {emp.active_jobs}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <span className="text-sm font-semibold text-gray-900">{fmt(emp.lifetime_revenue)}</span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <button
                      onClick={() => setEditEmp(emp)}
                      className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                    >
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

      {addOpen  && <AddModal onClose={() => setAddOpen(false)} />}
      {editEmp  && <EditModal emp={editEmp} onClose={() => setEditEmp(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Contribution tab
// ---------------------------------------------------------------------------

function ContribTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-lg text-sm">
      <p className="font-medium text-gray-700 mb-0.5">{label}</p>
      <p className="font-bold text-blue-600">{fmtFull(Number(payload[0].value ?? 0))}</p>
    </div>
  );
}

function ContributionTab() {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo]     = useState(defaultTo);

  const { data, isLoading } = useQuery<ContribData>({
    queryKey: ['employees-contribution', from, to],
    queryFn: () =>
      api.get('/api/employees/contribution', { params: { from, to } }).then((r) => r.data.data),
  });

  const rows   = data?.rows ?? [];
  const meta   = data?.meta;
  const maxRev = Math.max(...rows.map((r) => r.paid_revenue), 1);

  const totalJobs      = rows.reduce((s, r) => s + r.total_jobs, 0);
  const totalCompleted = rows.reduce((s, r) => s + r.completed_jobs, 0);
  const totalRevenue   = meta?.totalRevenue ?? 0;
  const avgPerJob      = totalCompleted > 0 ? totalRevenue / totalCompleted : 0;

  const chartData = rows
    .filter((r) => r.paid_revenue > 0)
    .map((r) => ({ name: r.name.split(' ')[0], revenue: r.paid_revenue }));

  return (
    <div className="space-y-5">
      {/* Date controls */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 bg-white rounded-xl border border-gray-200 animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Total Jobs',       value: totalJobs,               accent: false },
              { label: 'Completed Jobs',   value: totalCompleted,          accent: false },
              { label: 'Total Revenue',    value: fmt(totalRevenue),       accent: true  },
              { label: 'Avg per Job',      value: fmt(avgPerJob),          accent: false },
            ].map(({ label, value, accent }) => (
              <div key={label} className="bg-white rounded-xl border border-gray-200 px-5 py-4 text-center">
                <StatPill label={label} value={value} accent={accent} />
              </div>
            ))}
          </div>

          {/* Bar chart */}
          {chartData.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-900">Revenue by Team Member</h3>
                <p className="text-xs text-gray-400 mt-0.5">From paid invoices in the selected period</p>
              </div>
              <div className="px-4 py-5">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={fmt} tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={72} />
                    <Tooltip content={ContribTooltip} cursor={{ fill: '#eff6ff' }} />
                    <Bar dataKey="revenue" fill="#2563eb" radius={[4, 4, 0, 0]} maxBarSize={52} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Detail table */}
          {rows.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 flex items-center justify-center h-32 text-sm text-gray-400">
              No data for this period
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">#</th>
                    <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Name</th>
                    <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center">Jobs</th>
                    <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center">Done</th>
                    <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center">Active</th>
                    <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Revenue</th>
                    <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Avg/Job</th>
                    <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider w-32">Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((row, idx) => {
                    const share = totalRevenue > 0 ? (row.paid_revenue / totalRevenue) * 100 : 0;
                    return (
                      <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3.5">
                          <span className="text-xs font-bold text-gray-400">#{idx + 1}</span>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2.5">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-bold ${avatarColour(row.id)} ${!row.active ? 'opacity-40' : ''}`}>
                              {initials(row.name)}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-gray-900">{row.name}</p>
                              <RoleBadge role={row.role} />
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-center text-sm text-gray-700">{row.total_jobs}</td>
                        <td className="px-5 py-3.5 text-center">
                          <span className="text-sm font-semibold text-emerald-600">{row.completed_jobs}</span>
                        </td>
                        <td className="px-5 py-3.5 text-center">
                          <span className={`text-sm font-semibold ${row.active_jobs > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                            {row.active_jobs}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <span className="text-sm font-bold text-gray-900">{fmtFull(row.paid_revenue)}</span>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <span className="text-sm text-gray-600">{fmtFull(row.avg_invoice_value)}</span>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-500 rounded-full"
                                style={{ width: `${(row.paid_revenue / maxRev) * 100}%` }}
                              />
                            </div>
                            <span className="text-xs font-medium text-gray-500 w-9 text-right">
                              {share.toFixed(0)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Permissions tab
// ---------------------------------------------------------------------------

interface PermRow {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  active: boolean;
  permissions: string[];
}

function PermissionsTab() {
  const qc = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);

  const { data: staff = [], isLoading } = useQuery<PermRow[]>({
    queryKey: ['permissions'],
    queryFn: () => api.get('/api/permissions').then((r) => r.data.data),
  });

  async function toggleSection(user: PermRow, section: string) {
    const next = user.permissions.includes(section)
      ? user.permissions.filter((s) => s !== section)
      : [...user.permissions, section];

    setSaving(user.id + section);
    try {
      await api.put(`/api/permissions/${user.id}`, { sections: next });
      qc.setQueryData<PermRow[]>(['permissions'], (prev = []) =>
        prev.map((u) => (u.id === user.id ? { ...u, permissions: next } : u)),
      );
    } catch (err) {
      alert(apiErr(err));
    } finally {
      setSaving(null);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-white rounded-xl border border-gray-200 animate-pulse" />
        ))}
      </div>
    );
  }

  if (staff.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 flex items-center justify-center h-40 text-sm text-gray-400">
        No staff members to configure
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50">
            <th className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Member</th>
            {SECTIONS.map((s) => (
              <th key={s.key} className="px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider text-center whitespace-nowrap">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {staff.map((user) => (
            <tr key={user.id} className={`hover:bg-gray-50 transition-colors ${!user.active ? 'opacity-50' : ''}`}>
              <td className="px-5 py-3.5">
                <div className="flex items-center gap-2.5">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-bold ${avatarColour(user.id)}`}>
                    {initials(user.name)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900 whitespace-nowrap">{user.name}</p>
                    <RoleBadge role={user.role} />
                  </div>
                </div>
              </td>
              {SECTIONS.map((s) => {
                const checked = user.permissions.includes(s.key);
                const busy = saving === user.id + s.key;
                return (
                  <td key={s.key} className="px-3 py-3.5 text-center">
                    <button
                      type="button"
                      disabled={!!saving || !user.active}
                      onClick={() => toggleSection(user, s.key)}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent
                        transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1
                        disabled:cursor-not-allowed
                        ${checked ? 'bg-blue-600' : 'bg-gray-200'}
                        ${busy ? 'opacity-50' : ''}`}
                      aria-pressed={checked}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform
                          ring-0 transition duration-200
                          ${checked ? 'translate-x-4' : 'translate-x-0'}`}
                      />
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-5 py-3 text-xs text-gray-400 border-t border-gray-100">
        Permissions take effect immediately — no re-login required.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Tab = 'team' | 'contribution' | 'permissions';

export function EmployeesPage() {
  const [tab, setTab] = useState<Tab>('team');
  const { user } = useAuthStore();
  const canManagePermissions = user?.role === 'owner' || user?.role === 'admin';

  const tabs: [Tab, string][] = [
    ['team', 'Team'],
    ['contribution', 'Contribution'],
    ...(canManagePermissions ? [['permissions', 'Permissions'] as [Tab, string]] : []),
  ];

  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Employees</h1>
          <p className="text-xs text-gray-400 mt-0.5">Manage your team and track their revenue contribution</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                tab === key
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'team'         && <TeamTab />}
        {tab === 'contribution' && <ContributionTab />}
        {tab === 'permissions'  && <PermissionsTab />}

      </div>
    </AppLayout>
  );
}
