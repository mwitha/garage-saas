import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useAuthStore } from '../store/authStore';

const schema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

type FormData = z.infer<typeof schema>;

const FEATURES = [
  'Kanban work order tracking',
  'Automated customer invoicing',
  'Inventory & parts management',
  'Business analytics & reports',
];

export function LoginPage() {
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
      const res = await api.post('/api/auth/login', data);
      const { token, user, workshop, permissions = [] } = res.data;
      localStorage.setItem('token', token);
      setAuth(token, user, workshop, permissions);
      navigate('/dashboard', { replace: true });
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })
          .response?.data?.message ?? 'Login failed. Please try again.';
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
          <h2 className="text-4xl font-bold text-white leading-tight mb-4">
            The complete<br />workshop platform
          </h2>
          <p className="text-slate-400 text-base mb-10 leading-relaxed">
            Manage work orders, inventory, customers, and invoices — all in one place.
          </p>
          <div className="space-y-4">
            {FEATURES.map((f) => (
              <div key={f} className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-600/20 flex items-center justify-center flex-shrink-0">
                  <svg className="w-3.5 h-3.5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <span className="text-slate-300 text-sm">{f}</span>
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
            <h1 className="text-2xl font-bold text-gray-900">Welcome back</h1>
            <p className="text-sm text-gray-500 mt-1">Sign in to your workshop account</p>
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

            <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Email address
                </label>
                <input
                  type="email"
                  autoComplete="email"
                  {...register('email')}
                  className={`w-full rounded-lg border px-4 py-2.5 text-sm text-gray-900 outline-none transition
                    placeholder:text-gray-400 focus:ring-2
                    ${errors.email
                      ? 'border-red-400 focus:border-red-400 focus:ring-red-100'
                      : 'border-gray-300 focus:border-blue-500 focus:ring-blue-100'
                    }`}
                  placeholder="you@workshop.lk"
                />
                {errors.email && (
                  <p className="mt-1.5 text-xs text-red-600">{errors.email.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  autoComplete="current-password"
                  {...register('password')}
                  className={`w-full rounded-lg border px-4 py-2.5 text-sm text-gray-900 outline-none transition
                    placeholder:text-gray-400 focus:ring-2
                    ${errors.password
                      ? 'border-red-400 focus:border-red-400 focus:ring-red-100'
                      : 'border-gray-300 focus:border-blue-500 focus:ring-blue-100'
                    }`}
                  placeholder="••••••••"
                />
                {errors.password && (
                  <p className="mt-1.5 text-xs text-red-600">{errors.password.message}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white
                  hover:bg-blue-700 active:bg-blue-800
                  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                  disabled:opacity-60 disabled:cursor-not-allowed
                  transition-colors mt-1 flex items-center justify-center gap-2"
              >
                {isSubmitting && (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                {isSubmitting ? 'Signing in…' : 'Sign in'}
              </button>

            </form>
          </div>

          <p className="text-center text-sm text-gray-500 mt-6">
            Don&apos;t have an account?{' '}
            <Link to="/register" className="font-medium text-blue-600 hover:text-blue-700">
              Register your workshop
            </Link>
          </p>

        </div>
      </div>

    </div>
  );
}
