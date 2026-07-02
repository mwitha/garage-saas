import { useAuthStore } from '../store/authStore';
import { hasPermission } from '../lib/permissions';

interface Props {
  section: string;
  children: React.ReactNode;
}

export default function PermissionGate({ section, children }: Props) {
  const { user, permissions } = useAuthStore();

  if (hasPermission(user, permissions, section)) {
    return <>{children}</>;
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div className="text-5xl mb-4">🔒</div>
      <h2 className="text-xl font-semibold text-gray-800 mb-2">Access Restricted</h2>
      <p className="text-gray-500 max-w-sm">
        You don't have permission to view this section. Contact your workshop owner or admin to request access.
      </p>
    </div>
  );
}
