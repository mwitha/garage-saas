import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useAuthStore } from '../store/authStore';

const schema = z
  .object({
    workshopName: z.string().min(1, 'Workshop name is required'),
    ownerName: z.string().min(1, 'Your name is required'),
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type FormData = z.infer<typeof schema>;

interface FieldConfig {
  name: keyof FormData;
  label: string;
  type: string;
  placeholder: string;
  autoComplete?: string;
}

const FIELDS: FieldConfig[] = [
  { name: 'workshopName', label: 'Workshop name',     type: 'text',     placeholder: 'Silva Auto Service' },
  { name: 'ownerName',    label: 'Your name',          type: 'text',     placeholder: 'Kamal Silva', autoComplete: 'name' },
  { name: 'email',        label: 'Email address',      type: 'email',    placeholder: 'kamal@workshop.lk', autoComplete: 'email' },
  { name: 'password',     label: 'Password',           type: 'password', placeholder: '••••••••', autoComplete: 'new-password' },
  { name: 'confirmPassword', label: 'Confirm password', type: 'password', placeholder: '••••••••', autoComplete: 'new-password' },
];

const STEPS = [
  { title: 'Workshop details', desc: 'Set up your garage profile' },
  { title: 'Work order board',   desc: 'Track jobs from intake to delivery' },
  { title: 'Invoicing',          desc: 'Generate professional invoices instantly' },
];

export function RegisterPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [apiError, setApiError] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    setApiError('');
    try {
      const res = await api.post('/api/auth/register', {
        workshopName: data.workshopName,
        ownerName: data.ownerName,
        email: data.email,
        password: data.password,
      });
      const { token, user, workshop } = res.data;
      localStorage.setItem('token', token);
      setAuth(token, user, workshop);
      navigate('/dashboard', { replace: true });
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })
          .response?.data?.message ?? 'Registration failed. Please try again.';
      setApiError(message);
    }
  };

  return (
    <div className="min-h-screen flex">

      {/* Left panel */}
      <div className="hidden lg:flex lg:w-5/12 xl:w-1/2 bg-slate-900 flex-col p-12 relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 right-0 w-96 h-96 bg-blue-600/10 rounded-full -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-600/5 rounded-full translate-y-1/2 -translate-x-1/2" />
        </div>

        {/* Brand */}
        <div className="flex items-center gap-3 relative">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
            </svg>
          </div>
          <span className="text-xl font-bold text-white tracking-tight">GarageSaaS</span>
        </div>

        {/* Pitch */}
        <div className="flex-1 flex flex-col justify-center relative">
          <div className="inline-flex items-center gap-2 bg-blue-600/10 border border-blue-600/20 rounded-full px-3 py-1 mb-6 w-fit">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
            <span className="text-blue-400 text-xs font-medium">Get started for free</span>
          </div>
          <h2 className="text-4xl font-bold text-white leading-tight mb-4">
            Run your workshop<br />like a pro
          </h2>
          <p className="text-slate-400 text-base mb-10 leading-relaxed">
            Everything you need to manage customers, vehicles, jobs, parts, and invoices.
          </p>
          <div className="space-y-5">
            {STEPS.map((s, i) => (
              <div key={s.title} className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-lg bg-blue-600/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-xs font-bold text-blue-400">{i + 1}</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-200">{s.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-slate-600 text-xs relative">
          © 2026 GarageSaaS. Built for automotive workshops.
        </p>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center bg-gray-50 px-6 py-12">
        <div className="w-full max-w-md">

          {/* Mobile brand */}
          <div className="lg:hidden text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 mb-4">
              <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
              </svg>
            </div>
            <p className="text-lg font-bold text-gray-900">GarageSaaS</p>
          </div>

          {/* Heading */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900">Create your account</h1>
            <p className="text-sm text-gray-500 mt-1">Set up your workshop in under a minute</p>
          </div>

          {/* Card */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">

            {apiError && (
              <div className="mb-5 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
                <svg className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {apiError}
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">

              {FIELDS.map(({ name, label, type, placeholder, autoComplete }) => (
                <div key={name}>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    {label}
                  </label>
                  <input
                    type={type}
                    autoComplete={autoComplete}
                    {...register(name)}
                    className={`w-full rounded-lg border px-4 py-2.5 text-sm text-gray-900 outline-none transition
                      placeholder:text-gray-400 focus:ring-2
                      ${errors[name]
                        ? 'border-red-400 focus:border-red-400 focus:ring-red-100'
                        : 'border-gray-300 focus:border-blue-500 focus:ring-blue-100'
                      }`}
                    placeholder={placeholder}
                  />
                  {errors[name] && (
                    <p className="mt-1.5 text-xs text-red-600">{errors[name]?.message}</p>
                  )}
                </div>
              ))}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white
                  hover:bg-blue-700 active:bg-blue-800
                  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                  disabled:opacity-60 disabled:cursor-not-allowed
                  transition-colors mt-2 flex items-center justify-center gap-2"
              >
                {isSubmitting && (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                {isSubmitting ? 'Creating account…' : 'Create account'}
              </button>

            </form>
          </div>

          <p className="text-center text-sm text-gray-500 mt-6">
            Already have an account?{' '}
            <Link to="/login" className="font-medium text-blue-600 hover:text-blue-700">
              Sign in
            </Link>
          </p>

        </div>
      </div>

    </div>
  );
}
