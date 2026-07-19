import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorkshopSettings {
  name: string;
  phone: string | null;
  phone2: string | null;
  address: string | null;
  city: string | null;
  logo_url: string | null;
  email: string | null;
  website: string | null;
}

interface Props {
  /** e.g. "INVOICE", "WORK ORDER", "REPORT" — displayed large on the right */
  docTitle?: string;
  /** Reference number displayed below docTitle — e.g. "INV-00001" */
  docNumber?: string;
  /** Optional badge node (status pill) displayed below docNumber */
  badge?: React.ReactNode;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CompanyHeader({ docTitle, docNumber, badge, className = '' }: Props) {
  const { data: s, isLoading } = useQuery<WorkshopSettings>({
    queryKey: ['settings'],
    queryFn: () => api.get('/api/settings').then((r) => r.data.data),
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className={`flex items-start justify-between px-8 py-7 print:px-0 print:py-3 border-b border-gray-100 ${className}`}>
        <div className="flex items-start gap-4 animate-pulse">
          <div className="w-14 h-14 rounded-lg bg-gray-100 flex-shrink-0" />
          <div className="space-y-2 pt-1">
            <div className="h-5 w-40 bg-gray-100 rounded" />
            <div className="h-3.5 w-56 bg-gray-100 rounded" />
            <div className="h-3.5 w-28 bg-gray-100 rounded" />
          </div>
        </div>
        {docTitle && (
          <div className="text-right space-y-2 animate-pulse">
            <div className="h-8 w-28 bg-gray-100 rounded ml-auto" />
            {docNumber && <div className="h-4 w-24 bg-gray-100 rounded ml-auto" />}
          </div>
        )}
      </div>
    );
  }

  const location = [s?.address, s?.city].filter(Boolean).join(', ');

  return (
    <div className={`flex items-start justify-between px-8 py-7 print:px-0 print:py-3 border-b border-gray-100 ${className}`}>

      {/* Left: logo + business details */}
      <div className="flex items-start gap-4">
        {s?.logo_url ? (
          <img
            src={s.logo_url}
            alt={s.name}
            className="w-14 h-14 object-contain flex-shrink-0 rounded-lg"
          />
        ) : (
          <div className="w-14 h-14 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-7 h-7 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
            </svg>
          </div>
        )}

        <div>
          <h2 className="text-xl font-bold text-gray-900 leading-tight">
            {s?.name ?? '—'}
          </h2>
          {location && (
            <p className="text-sm text-gray-500 mt-0.5">{location}</p>
          )}
          {s?.phone && (
            <p className="text-sm text-gray-500 mt-0.5 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              {s.phone}
              {s.phone2 && <span className="text-gray-300 mx-1">·</span>}
              {s.phone2}
            </p>
          )}
          {!s?.phone && s?.phone2 && (
            <p className="text-sm text-gray-500 mt-0.5 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              {s.phone2}
            </p>
          )}
          {(s?.email || s?.website) && (
            <p className="text-sm text-gray-500 mt-0.5">
              {s.email}
              {s.email && s.website && <span className="text-gray-300 mx-1">·</span>}
              {s.website}
            </p>
          )}
        </div>
      </div>

      {/* Right: document type label + number + badge */}
      {(docTitle || docNumber || badge) && (
        <div className="text-right flex-shrink-0 ml-6">
          {docTitle && (
            <p className="text-3xl font-black text-blue-600 tracking-tight uppercase">{docTitle}</p>
          )}
          {docNumber && (
            <p className="text-base font-mono font-bold text-gray-800 mt-1">{docNumber}</p>
          )}
          {badge && <div className="mt-1.5 flex justify-end">{badge}</div>}
        </div>
      )}
    </div>
  );
}
