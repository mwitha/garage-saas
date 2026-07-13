import { Request, Response, NextFunction } from 'express';

// Maps API path prefixes to the section key they require
const PATH_PERMISSION_MAP: [string, string][] = [
  ['/api/customers',     'customers'],
  ['/api/vehicles',      'customers'],
  ['/api/work-orders',   'work_orders'],
  ['/api/notifications', 'work_orders'],
  ['/api/invoices',      'invoices'],
  ['/api/inventory',     'inventory'],
  ['/api/service-items', 'inventory'],
  ['/api/fault-reports', 'inventory'],
  ['/api/issue-notes',   'inventory'],
  ['/api/reports',       'reports'],
  ['/api/employees',     'employees'],
  ['/api/suppliers',     'suppliers'],
  ['/api/grns',          'suppliers'],
  ['/api/settings',      'settings'],
  ['/api/bank-accounts', 'settings'],
  ['/api/permissions',   'employees'],
  ['/api/expenses',      'expenses'],
];

function requiredSection(path: string): string | null {
  for (const [prefix, section] of PATH_PERMISSION_MAP) {
    if (path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '?')) {
      return section;
    }
  }
  return null; // /api/auth, /api/dashboard → always allowed
}

export function checkPermission(req: Request, res: Response, next: NextFunction): void {
  // No user attached means requireAuth didn't run yet — skip (shouldn't happen)
  if (!req.user) { next(); return; }

  // Owner bypasses all section checks
  if (req.user.role === 'owner') { next(); return; }

  const section = requiredSection(req.path);
  if (!section) { next(); return; } // unguarded path

  if (!req.user.permissions.includes(section)) {
    res.status(403).json({ data: null, error: { message: `Access denied: requires '${section}' permission` } });
    return;
  }

  next();
}
