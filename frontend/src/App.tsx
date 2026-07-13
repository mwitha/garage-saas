import { Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DashboardPage } from './pages/DashboardPage';
import { CustomerList } from './pages/customers/CustomerList';
import { CustomerDetail } from './pages/customers/CustomerDetail';
import { VehicleDetail } from './pages/vehicles/VehicleDetail';
import { WorkOrderList } from './pages/workorders/WorkOrderList';
import { WorkOrderDetail } from './pages/workorders/WorkOrderDetail';
import { InvoiceList } from './pages/invoices/InvoiceList';
import { InvoiceDetail } from './pages/invoices/InvoiceDetail';
import { InventoryList } from './pages/inventory/InventoryList';
import { FaultReports } from './pages/inventory/FaultReports';
import { IssueNotesPage } from './pages/inventory/IssueNotesPage';
import { ServicesPage } from './pages/services/ServicesPage';
import { ReportsPage } from './pages/reports/ReportsPage';
import { EmployeesPage } from './pages/employees/EmployeesPage';
import { SuppliersPage } from './pages/suppliers/SuppliersPage';
import { SettingsPage } from './pages/SettingsPage';
import { ExpensesPage } from './pages/expenses/ExpensesPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import PermissionGate from './components/PermissionGate';

function App() {
  return (
    <Routes>
      <Route path="/login"    element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard"       element={<DashboardPage />} />
        <Route path="/customers"       element={<PermissionGate section="customers"><CustomerList /></PermissionGate>} />
        <Route path="/customers/:id"   element={<PermissionGate section="customers"><CustomerDetail /></PermissionGate>} />
        <Route path="/vehicles/:id"    element={<PermissionGate section="customers"><VehicleDetail /></PermissionGate>} />
        <Route path="/work-orders"     element={<PermissionGate section="work_orders"><WorkOrderList /></PermissionGate>} />
        <Route path="/work-orders/:id" element={<PermissionGate section="work_orders"><WorkOrderDetail /></PermissionGate>} />
        <Route path="/invoices"        element={<PermissionGate section="invoices"><InvoiceList /></PermissionGate>} />
        <Route path="/invoices/:id"    element={<PermissionGate section="invoices"><InvoiceDetail /></PermissionGate>} />
        <Route path="/inventory"       element={<PermissionGate section="inventory"><InventoryList /></PermissionGate>} />
        <Route path="/services"        element={<PermissionGate section="inventory"><ServicesPage /></PermissionGate>} />
        <Route path="/fault-reports"   element={<PermissionGate section="inventory"><FaultReports /></PermissionGate>} />
        <Route path="/issue-notes"     element={<PermissionGate section="inventory"><IssueNotesPage /></PermissionGate>} />
        <Route path="/reports"         element={<PermissionGate section="reports"><ReportsPage /></PermissionGate>} />
        <Route path="/employees"       element={<PermissionGate section="employees"><EmployeesPage /></PermissionGate>} />
        <Route path="/suppliers"       element={<PermissionGate section="suppliers"><SuppliersPage /></PermissionGate>} />
        <Route path="/settings"        element={<PermissionGate section="settings"><SettingsPage /></PermissionGate>} />
        <Route path="/expenses"        element={<PermissionGate section="expenses"><ExpensesPage /></PermissionGate>} />
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default App;
