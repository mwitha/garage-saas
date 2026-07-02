import { useNavigate } from 'react-router-dom';
import type { Vehicle } from '../../types';

interface Props {
  vehicle: Vehicle;
}

// Fuel type icon colours
const FUEL_COLOUR: Record<string, string> = {
  petrol:   'bg-orange-100 text-orange-700',
  diesel:   'bg-yellow-100 text-yellow-700',
  hybrid:   'bg-green-100  text-green-700',
  electric: 'bg-blue-100   text-blue-700',
  lpg:      'bg-purple-100 text-purple-700',
  other:    'bg-gray-100   text-gray-600',
};

function Chip({ label, colour }: { label: string; colour?: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize
      ${colour ?? 'bg-gray-100 text-gray-600'}`}>
      {label}
    </span>
  );
}

export function VehicleCard({ vehicle: v }: Props) {
  const navigate = useNavigate();

  const handleCardClick = () => navigate(`/vehicles/${v.id}`);
  const handleNewWO = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/work-orders/new?vehicleId=${v.id}`);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={(e) => e.key === 'Enter' && handleCardClick()}
      className="bg-white rounded-xl border border-gray-200 hover:border-blue-300
        hover:shadow-sm transition-all cursor-pointer group outline-none
        focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      {/* Card header */}
      <div className="flex items-start justify-between px-5 pt-5 pb-3">
        <div className="min-w-0">
          <p className="text-base font-mono font-bold text-gray-900 tracking-wide group-hover:text-blue-700 transition-colors">
            {v.plate_number}
          </p>
          <p className="text-sm text-gray-600 mt-0.5 truncate">
            {v.make} <span className="text-gray-400">{v.model}</span>
          </p>
        </div>
        {/* Color swatch */}
        {v.color && (
          <span className="text-xs text-gray-400 mt-0.5 shrink-0 ml-3">{v.color}</span>
        )}
      </div>

      {/* Chips row */}
      <div className="flex items-center gap-1.5 flex-wrap px-5 pb-4">
        {v.year && <Chip label={String(v.year)} />}
        {v.fuel_type && (
          <Chip label={v.fuel_type} colour={FUEL_COLOUR[v.fuel_type]} />
        )}
        {v.transmission && (
          <Chip label={v.transmission === 'auto' ? 'Automatic' : 'Manual'} />
        )}
        {v.engine_capacity && <Chip label={v.engine_capacity} />}
        {v.mileage != null && (
          <Chip label={`${v.mileage.toLocaleString()} km`} />
        )}
      </div>

      {/* Footer */}
      <div
        className="flex items-center justify-between px-5 py-3
          border-t border-gray-100 bg-gray-50 rounded-b-xl"
      >
        <button
          onClick={handleNewWO}
          className="flex items-center gap-1 text-xs font-semibold text-blue-600
            hover:text-blue-800 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Work Order
        </button>

        <span className="flex items-center gap-1 text-xs text-gray-400 group-hover:text-blue-500 transition-colors">
          View detail
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </span>
      </div>
    </div>
  );
}
