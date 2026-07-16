import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AppLayout } from '../components/AppLayout';
import { useAuthStore } from '../store/authStore';
import api from '../lib/api';

// ---------------------------------------------------------------------------
// Bank Accounts types + components
// ---------------------------------------------------------------------------

const ACCOUNT_TYPES = [
  { value: 'current',       label: 'Current' },
  { value: 'savings',       label: 'Savings' },
  { value: 'fixed_deposit', label: 'Fixed Deposit' },
  { value: 'other',         label: 'Other' },
] as const;

interface BankAccount {
  id: string;
  bank_name: string;
  branch_name: string | null;
  account_name: string;
  account_number: string;
  account_type: string;
  swift_code: string | null;
  is_primary: boolean;
  notes: string | null;
}

const bankSchema = z.object({
  bank_name:      z.string().min(1, 'Bank name is required'),
  branch_name:    z.string().optional(),
  account_name:   z.string().min(1, 'Account name is required'),
  account_number: z.string().min(1, 'Account number is required'),
  account_type:   z.enum(['current', 'savings', 'fixed_deposit', 'other']).default('current'),
  swift_code:     z.string().optional(),
  is_primary:     z.boolean().default(false),
  notes:          z.string().optional(),
});
type BankForm = z.infer<typeof bankSchema>;

function bankApiErr(err: unknown) {
  return (err as { response?: { data?: { error?: { message?: string } } } })
    ?.response?.data?.error?.message ?? 'Something went wrong';
}

function BankModal({ account, onClose }: { account?: BankAccount; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!account;

  const { register, handleSubmit, formState: { errors } } = useForm<BankForm>({
    resolver: zodResolver(bankSchema) as any,
    defaultValues: account ? {
      bank_name:      account.bank_name,
      branch_name:    account.branch_name  ?? '',
      account_name:   account.account_name,
      account_number: account.account_number,
      account_type:   account.account_type as BankForm['account_type'],
      swift_code:     account.swift_code   ?? '',
      is_primary:     account.is_primary,
      notes:          account.notes        ?? '',
    } : { account_type: 'current', is_primary: false },
  });

  const saveMutation = useMutation({
    mutationFn: (data: BankForm) =>
      isEdit
        ? api.patch(`/api/bank-accounts/${account!.id}`, data).then((r) => r.data.data)
        : api.post('/api/bank-accounts', data).then((r) => r.data.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bank-accounts'] }); onClose(); },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/bank-accounts/${account!.id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bank-accounts'] }); onClose(); },
  });

  const bInputCls = (err?: string) =>
    `w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2
     focus:ring-blue-500 focus:border-transparent ${err ? 'border-red-300' : 'border-gray-200'}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900">
            {isEdit ? 'Edit Bank Account' : 'Add Bank Account'}
          </h2>
          <button onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit((d) => saveMutation.mutate(d))} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Bank Name *</label>
              <input {...register('bank_name')} autoFocus placeholder="e.g. Bank of Ceylon"
                className={bInputCls(errors.bank_name?.message)} />
              {errors.bank_name && <p className="text-xs text-red-500 mt-0.5">{errors.bank_name.message}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Branch</label>
              <input {...register('branch_name')} placeholder="e.g. Colombo Main"
                className={bInputCls()} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Account Name *</label>
            <input {...register('account_name')} placeholder="Name on the account"
              className={bInputCls(errors.account_name?.message)} />
            {errors.account_name && <p className="text-xs text-red-500 mt-0.5">{errors.account_name.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Account Number *</label>
              <input {...register('account_number')} placeholder="e.g. 1234567890"
                className={bInputCls(errors.account_number?.message)} />
              {errors.account_number && <p className="text-xs text-red-500 mt-0.5">{errors.account_number.message}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Account Type</label>
              <select {...register('account_type')} className={bInputCls()}>
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">SWIFT / BIC Code</label>
            <input {...register('swift_code')} placeholder="e.g. BCEYLKLX (optional)"
              className={bInputCls()} />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
            <textarea {...register('notes')} rows={2} placeholder="Any additional details"
              className={`${bInputCls()} resize-none`} />
          </div>

          <label className="flex items-center gap-3 cursor-pointer select-none pt-1">
            <input type="checkbox" {...register('is_primary')}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            <span className="text-sm text-gray-700">Set as primary account</span>
          </label>

          {saveMutation.isError && (
            <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {bankApiErr(saveMutation.error)}
            </p>
          )}

          <div className="flex items-center justify-between pt-1">
            {isEdit ? (
              <button type="button"
                onClick={() => { if (confirm('Delete this bank account?')) deleteMutation.mutate(); }}
                disabled={deleteMutation.isPending}
                className="text-xs font-medium text-red-500 hover:text-red-700 transition-colors disabled:opacity-60">
                Delete
              </button>
            ) : <span />}
            <div className="flex gap-3">
              <button type="button" onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
                Cancel
              </button>
              <button type="submit" disabled={saveMutation.isPending}
                className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg
                  hover:bg-blue-700 disabled:opacity-60 transition-colors">
                {saveMutation.isPending ? 'Saving…' : isEdit ? 'Save' : 'Add Account'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function BankAccountsTab() {
  const [modal, setModal] = useState<'add' | BankAccount | null>(null);

  const { data: accounts = [], isLoading } = useQuery<BankAccount[]>({
    queryKey: ['bank-accounts'],
    queryFn: () => api.get('/api/bank-accounts').then((r) => r.data.data),
  });

  const accountTypeLabel = (v: string) =>
    ACCOUNT_TYPES.find((t) => t.value === v)?.label ?? v;

  return (
    <>
      <div className="flex justify-end mb-4">
        <button
          onClick={() => setModal('add')}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white
            bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add Account
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-24 bg-white rounded-xl border border-gray-200 animate-pulse" />
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 flex flex-col items-center justify-center h-48 gap-3">
          <svg className="w-10 h-10 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
          </svg>
          <p className="text-sm text-gray-400">No bank accounts added yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((acc) => (
            <div key={acc.id}
              className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex items-start justify-between gap-4 hover:border-blue-200 transition-colors">
              <div className="flex items-start gap-4 min-w-0">
                {/* Bank icon */}
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900">{acc.bank_name}</span>
                    {acc.branch_name && (
                      <span className="text-xs text-gray-400">— {acc.branch_name}</span>
                    )}
                    {acc.is_primary && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
                        Primary
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-700 mt-0.5">{acc.account_name}</p>
                  <div className="flex items-center gap-4 mt-1.5 flex-wrap">
                    <span className="text-xs font-mono text-gray-600 tracking-wider">{acc.account_number}</span>
                    <span className="text-xs text-gray-400">{accountTypeLabel(acc.account_type)}</span>
                    {acc.swift_code && (
                      <span className="text-xs text-gray-400">SWIFT: {acc.swift_code}</span>
                    )}
                  </div>
                  {acc.notes && (
                    <p className="text-xs text-gray-400 mt-1">{acc.notes}</p>
                  )}
                </div>
              </div>

              <button
                onClick={() => setModal(acc)}
                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {modal === 'add' && <BankModal onClose={() => setModal(null)} />}
      {modal && modal !== 'add' && <BankModal account={modal as BankAccount} onClose={() => setModal(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorkshopSettings {
  id: string;
  name: string;
  phone: string | null;
  phone2: string | null;
  address: string | null;
  city: string | null;
  logo_url: string | null;
  email: string | null;
  website: string | null;
  currency: string;
  tax_label: string;
  tax_rate: number;
  tax_enabled: boolean;
  invoice_prefix: string;
  order_prefix: string;
  owner_email: string;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const schema = z.object({
  name:           z.string().min(1, 'Business name is required'),
  phone:          z.string().optional(),
  phone2:         z.string().optional(),
  address:        z.string().optional(),
  city:           z.string().optional(),
  email:          z.string().email('Invalid email').optional().or(z.literal('')),
  website:        z.string().optional(),
  currency:       z.string().min(1),
  tax_enabled:    z.boolean(),
  tax_label:      z.string().optional(),
  tax_rate:       z.preprocess((v) => Number(v), z.number().min(0).max(100)).optional(),
  invoice_prefix: z.string().min(1).max(10),
  order_prefix:   z.string().min(1).max(10),
});

type FormData = z.infer<typeof schema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function apiErrMsg(err: unknown) {
  return (err as { response?: { data?: { error?: { message?: string } } } })
    ?.response?.data?.error?.message ?? 'Something went wrong';
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
      {children}
    </h2>
  );
}

function Field({
  label, error, children,
}: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {children}
      {error && <p className="text-xs text-red-500 mt-0.5">{error}</p>}
    </div>
  );
}

const inputCls = (err?: string) =>
  `w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2
   focus:ring-blue-500 focus:border-transparent ${err ? 'border-red-300' : 'border-gray-200'}`;

// ---------------------------------------------------------------------------
// Logo uploader
// ---------------------------------------------------------------------------

function LogoUploader({ currentUrl, onUploaded }: {
  currentUrl: string | null;
  onUploaded: (url: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(currentUrl);

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) { setError('Please select an image file'); return; }
    if (file.size > 2 * 1024 * 1024) { setError('Logo must be under 2 MB'); return; }
    setError(null);
    setUploading(true);
    try {
      // 1. Get presigned URL from backend
      const { data: { data: presign } } = await api.post('/api/settings/logo/presign', {
        contentType: file.type,
        fileName:    file.name,
      });

      // 2. PUT directly to S3
      await fetch(presign.uploadUrl, {
        method:  'PUT',
        body:    file,
        headers: { 'Content-Type': file.type },
      });

      // 3. Commit the public URL
      await api.patch('/api/settings/logo', { logoUrl: presign.publicUrl });

      setPreview(presign.publicUrl);
      onUploaded(presign.publicUrl);
    } catch (err) {
      setError(apiErrMsg(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <SectionTitle>Logo</SectionTitle>
      <div className="flex items-center gap-6">
        {/* Preview */}
        <div className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center overflow-hidden flex-shrink-0 bg-gray-50">
          {preview ? (
            <img src={preview} alt="Logo" className="w-full h-full object-contain" />
          ) : (
            <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18M3.75 3h16.5A.75.75 0 0121 3.75v13.5a.75.75 0 01-.75.75H3.75A.75.75 0 013 17.25V3.75A.75.75 0 013.75 3z" />
            </svg>
          )}
        </div>

        <div className="space-y-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="px-4 py-1.5 text-sm font-medium border border-gray-200 rounded-lg
              hover:bg-gray-50 disabled:opacity-60 transition-colors"
          >
            {uploading ? 'Uploading…' : preview ? 'Change logo' : 'Upload logo'}
          </button>
          <p className="text-xs text-gray-400">PNG, JPG, WebP or SVG · max 2 MB</p>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type SettingsTab = 'workshop' | 'bank';

function WorkshopTab() {
  const queryClient = useQueryClient();
  const { setAuth, user, workshop } = useAuthStore();
  const [saved, setSaved] = useState(false);

  const { data: settings, isLoading } = useQuery<WorkshopSettings>({
    queryKey: ['settings'],
    queryFn: () => api.get('/api/settings').then((r) => r.data.data),
  });

  const { register, handleSubmit, formState: { errors, isDirty }, reset, watch, setValue } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    values: settings ? {
      name:           settings.name,
      phone:          settings.phone          ?? '',
      phone2:         settings.phone2         ?? '',
      address:        settings.address        ?? '',
      city:           settings.city           ?? '',
      email:          settings.email          ?? '',
      website:        settings.website        ?? '',
      currency:       settings.currency,
      tax_enabled:    settings.tax_enabled,
      tax_label:      settings.tax_label,
      tax_rate:       settings.tax_rate,
      invoice_prefix: settings.invoice_prefix,
      order_prefix:   settings.order_prefix,
    } : undefined,
  });

  const taxEnabled = watch('tax_enabled');

  const mutation = useMutation({
    mutationFn: (data: FormData) =>
      api.put('/api/settings', data).then((r) => r.data.data),
    onSuccess: (updated: WorkshopSettings) => {
      queryClient.setQueryData(['settings'], updated);
      reset({
        name:           updated.name,
        phone:          updated.phone          ?? '',
        phone2:         updated.phone2         ?? '',
        address:        updated.address        ?? '',
        city:           updated.city           ?? '',
        email:          updated.email          ?? '',
        website:        updated.website        ?? '',
        currency:       updated.currency,
        tax_enabled:    updated.tax_enabled,
        tax_label:      updated.tax_label,
        tax_rate:       updated.tax_rate,
        invoice_prefix: updated.invoice_prefix,
        order_prefix:   updated.order_prefix,
      });
      // Keep auth store workshop name in sync
      if (user && workshop) {
        setAuth(useAuthStore.getState().token!, user, { ...workshop, name: updated.name });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <div className="h-3 w-24 bg-gray-100 rounded animate-pulse" />
            <div className="grid grid-cols-2 gap-4">
              {[1, 2, 3, 4].map((j) => (
                <div key={j} className="h-9 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Saved toast */}
      {saved && (
        <div className="flex justify-end">
          <span className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Saved
          </span>
        </div>
      )}

      <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-6">

          {/* Logo */}
          <div className="bg-white rounded-xl border border-gray-200 px-6 py-5">
            <LogoUploader
              currentUrl={settings?.logo_url ?? null}
              onUploaded={() => queryClient.invalidateQueries({ queryKey: ['settings'] })}
            />
          </div>

          {/* Business info */}
          <div className="bg-white rounded-xl border border-gray-200 px-6 py-5 space-y-4">
            <SectionTitle>Business Information</SectionTitle>
            <Field label="Business name *" error={errors.name?.message}>
              <input {...register('name')} className={inputCls(errors.name?.message)} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Primary phone" error={errors.phone?.message}>
                <input {...register('phone')} placeholder="e.g. 0112345678" className={inputCls()} />
              </Field>
              <Field label="Secondary phone" error={errors.phone2?.message}>
                <input {...register('phone2')} placeholder="e.g. 0779876543" className={inputCls()} />
              </Field>
              <Field label="Address" error={errors.address?.message}>
                <input {...register('address')} placeholder="Street address" className={inputCls()} />
              </Field>
              <Field label="City" error={errors.city?.message}>
                <input {...register('city')} placeholder="e.g. Colombo" className={inputCls()} />
              </Field>
              <Field label="Email" error={errors.email?.message}>
                <input {...register('email')} placeholder="e.g. info@yourbusiness.com" className={inputCls(errors.email?.message)} />
              </Field>
              <Field label="Website" error={errors.website?.message}>
                <input {...register('website')} placeholder="e.g. www.yourbusiness.com" className={inputCls()} />
              </Field>
            </div>
          </div>

          {/* Invoice & tax settings */}
          <div className="bg-white rounded-xl border border-gray-200 px-6 py-5 space-y-4">
            <SectionTitle>Invoice &amp; Tax</SectionTitle>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Currency" error={errors.currency?.message}>
                <input {...register('currency')} placeholder="e.g. LKR" className={inputCls(errors.currency?.message)} />
              </Field>
              <div />
              <Field label="Invoice prefix" error={errors.invoice_prefix?.message}>
                <input
                  {...register('invoice_prefix')}
                  placeholder="e.g. INV"
                  className={inputCls(errors.invoice_prefix?.message)}
                />
                <p className="text-xs text-gray-400 mt-0.5">Invoices will be numbered INV-00001, INV-00002…</p>
              </Field>
              <Field label="Work order prefix" error={errors.order_prefix?.message}>
                <input
                  {...register('order_prefix')}
                  placeholder="e.g. WO"
                  className={inputCls(errors.order_prefix?.message)}
                />
                <p className="text-xs text-gray-400 mt-0.5">Orders will be numbered WO-00001, WO-00002…</p>
              </Field>
            </div>

            {/* Tax toggle */}
            <div className="pt-2 border-t border-gray-100">
              <label className="flex items-center justify-between cursor-pointer select-none">
                <div>
                  <p className="text-sm font-medium text-gray-700">Enable tax on invoices</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    When off, invoices are created with no tax line regardless of the rate below
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={taxEnabled}
                  onClick={() => setValue('tax_enabled', !taxEnabled, { shouldDirty: true })}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent
                    transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500
                    focus:ring-offset-2 ${taxEnabled ? 'bg-blue-600' : 'bg-gray-200'}`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow
                      ring-0 transition duration-200 ease-in-out
                      ${taxEnabled ? 'translate-x-5' : 'translate-x-0'}`}
                  />
                </button>
              </label>
            </div>

            {/* Tax fields — only shown when tax is enabled */}
            {taxEnabled && (
              <div className="grid grid-cols-2 gap-4 pt-2">
                <Field label="Tax label" error={errors.tax_label?.message}>
                  <input {...register('tax_label')} placeholder="e.g. VAT" className={inputCls(errors.tax_label?.message)} />
                </Field>
                <Field label="Tax rate (%)" error={errors.tax_rate?.message}>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    {...register('tax_rate')}
                    className={inputCls(errors.tax_rate?.message)}
                  />
                </Field>
              </div>
            )}
          </div>

          {mutation.isError && (
            <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {apiErrMsg(mutation.error)}
            </p>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={mutation.isPending || !isDirty}
              className="px-6 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg
                hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {mutation.isPending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

export function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>('workshop');
  const { data: settings } = useQuery<WorkshopSettings>({
    queryKey: ['settings'],
    queryFn: () => api.get('/api/settings').then((r) => r.data.data),
  });

  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-2xl mx-auto space-y-6">

        <div>
          <h1 className="text-lg font-semibold text-gray-900">Settings</h1>
          <p className="text-xs text-gray-400 mt-0.5">{settings?.owner_email}</p>
        </div>

        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
          {([['workshop', 'Workshop'], ['bank', 'Bank Accounts']] as [SettingsTab, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                tab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'workshop' && <WorkshopTab />}
        {tab === 'bank'     && <BankAccountsTab />}

      </div>
    </AppLayout>
  );
}
