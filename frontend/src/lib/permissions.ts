import type { AuthUser } from '../store/authStore';

export interface Section {
  key: string;
  label: string;
  navPath: string;
}

export const SECTIONS: Section[] = [
  { key: 'customers',   label: 'Customers',   navPath: '/customers' },
  { key: 'work_orders', label: 'Work Orders',  navPath: '/work-orders' },
  { key: 'invoices',    label: 'Invoices',     navPath: '/invoices' },
  { key: 'expenses',    label: 'Expenses',     navPath: '/expenses' },
  { key: 'inventory',   label: 'Inventory',    navPath: '/inventory' },
  { key: 'reports',     label: 'Reports',      navPath: '/reports' },
  { key: 'employees',   label: 'Employees',    navPath: '/employees' },
  { key: 'suppliers',   label: 'Suppliers',    navPath: '/suppliers' },
  { key: 'settings',    label: 'Settings',     navPath: '/settings' },
];

export function hasPermission(
  user: AuthUser | null,
  permissions: string[],
  section: string,
): boolean {
  if (!user) return false;
  if (user.role === 'owner') return true;
  return permissions.includes(section);
}
