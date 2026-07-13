export type WorkOrderStatus =
  | 'received' | 'diagnosing' | 'waiting_parts' | 'in_progress'
  | 'quality_check' | 'ready' | 'delivered' | 'cancelled';

export interface WorkOrderSummary {
  id: string;
  order_number: string;
  status: WorkOrderStatus;
  created_at: string;
  customer_complaint: string | null;
  plate_number: string;
  make: string;
  model: string;
  customer_name: string;
  assigned_to_name: string | null;
}

export interface DashboardStats {
  active_work_orders: number;
  vehicles_in_workshop: number;
  unpaid_invoices_total: number;
  unpaid_invoices_count: number;
  low_stock_items: number;
  revenue_today: number;
  revenue_this_month: number;
  revenue_last_month: number;
  expenses_this_month: number;
  expenses_last_month: number;
  completed_today: number;
  completed_this_month: number;
  completed_last_month: number;
  jobs_today: number;
}

export interface RevenueChartPoint {
  month: string;
  revenue: number;
  expenses: number;
}

export interface PipelineItem {
  status: WorkOrderStatus;
  count: number;
}

export interface LowStockItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  reorder_threshold: number;
}

export interface DashboardData {
  stats: DashboardStats;
  revenue_chart: RevenueChartPoint[];
  pipeline: PipelineItem[];
  low_stock_list: LowStockItem[];
  active_work_orders: WorkOrderSummary[];
  todays_jobs: WorkOrderSummary[];
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  city: string | null;
  nic_number: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomerListItem extends Customer {
  vehicle_count: number;
  last_visit: string | null;
}

export interface CustomersPage {
  customers: CustomerListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface Vehicle {
  id: string;
  customer_id: string;
  plate_number: string;
  make: string;
  model: string;
  year: number | null;
  color: string | null;
  fuel_type: string | null;
  engine_capacity: string | null;
  engine_number: string | null;
  transmission: string | null;
  mileage: number | null;
  vin: string | null;
  ac_system: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServiceHistoryItem {
  id: string;
  order_number: string;
  status: WorkOrderStatus;
  customer_complaint: string | null;
  created_at: string;
  completed_at: string | null;
  plate_number: string;
  make: string;
  model: string;
}

export interface OutstandingInvoice {
  id: string;
  invoice_number: string;
  status: 'draft' | 'sent' | 'overdue';
  total: number;
  due_date: string | null;
  created_at: string;
  plate_number: string;
  make: string;
  model: string;
  order_number: string;
}

export interface CustomerWithDetails extends Customer {
  vehicles: Vehicle[];
  recent_work_orders: ServiceHistoryItem[];
  outstanding_invoices: OutstandingInvoice[];
}

export interface VehicleWorkOrder {
  id: string;
  order_number: string;
  status: WorkOrderStatus;
  customer_complaint: string | null;
  created_at: string;
  completed_at: string | null;
  labour_cost: number;
  parts_total: number;
  total: number;
}

export interface VehicleWithDetails extends Vehicle {
  customer_name: string;
  customer_phone: string;
  work_orders: VehicleWorkOrder[];
}

export interface WorkOrderItem {
  id: string;
  inventory_item_id: string | null;
  service_item_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  created_at: string;
  stock_adjustment_id: string | null;
  part_number: string | null;
  unit: string | null;
  stock_quantity: number | null;
  reorder_threshold: number | null;
  inventory_name: string | null;
  supplier_name: string | null;
  supplier_phone: string | null;
  service_name: string | null;
  service_category: string | null;
}

export type FaultReportStatus =
  | 'open' | 'investigating' | 'supplier_contacted'
  | 'replacement_received' | 'written_off';

export interface FaultReport {
  id: string;
  status: FaultReportStatus;
  fault_description: string;
  supplier_name: string | null;
  supplier_phone: string | null;
  supplier_invoice: string | null;
  resolution_note: string | null;
  reported_at: string;
  resolved_at: string | null;
  part_name: string;
  part_number: string | null;
  work_order_number: string;
  work_order_id: string;
  plate_number: string;
  reported_by_name: string | null;
}

export interface WorkOrder {
  id: string;
  workshop_id: string;
  vehicle_id: string;
  assigned_to: string | null;
  order_number: string;
  status: WorkOrderStatus;
  customer_complaint: string | null;
  diagnosis: string | null;
  internal_notes: string | null;
  mileage_in: number | null;
  mileage_out: number | null;
  labour_cost: number;
  promised_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  // joined
  plate_number: string;
  make: string;
  model: string;
  year: number | null;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  assigned_to_name: string | null;
  // computed
  items: WorkOrderItem[];
  parts_total: number;
  total: number;
}

export interface WorkOrdersPage {
  work_orders: WorkOrderSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  phone: string | null;
}

export interface InventoryItem {
  id: string;
  name: string;
  part_number: string | null;
  category: string | null;
  unit: string;
  quantity: number;
  reorder_threshold: number;
  cost_price: number;
  selling_price: number;
  supplier_name: string | null;
  supplier_phone: string | null;
  location: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  low_stock: boolean;
}

export interface InventoryPage {
  items: InventoryItem[];
  total: number;
  page: number;
  limit: number;
}

export interface ServiceItem {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  price: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ServiceItemsPage {
  items: ServiceItem[];
  total: number;
  page: number;
  limit: number;
}

export type InvoiceStatus  = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
export type PaymentMethod  = 'cash' | 'card' | 'bank_transfer' | 'cheque' | 'other';

export interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export interface InvoiceSummary {
  id: string;
  invoice_number: string;
  status: InvoiceStatus;
  subtotal: number;
  tax_amount: number;
  discount: number;
  total: number;
  payment_method: PaymentMethod | null;
  payment_reference: string | null;
  paid_at: string | null;
  due_date: string | null;
  created_at: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  plate_number: string;
  make: string;
  model: string;
  order_number: string;
  work_order_id: string;
}

export interface Invoice extends InvoiceSummary {
  notes: string | null;
  tax_rate: number;
  updated_at: string;
  work_order_id: string;
  vehicle_id: string;
  customer_email: string | null;
  customer_address: string | null;
  customer_complaint: string | null;
  year: number | null;
  color: string | null;
  fuel_type: string | null;
  mileage_in: number | null;
  mileage_out: number | null;
  workshop_name: string;
  workshop_address: string | null;
  workshop_city: string | null;
  workshop_phone: string | null;
  logo_url: string | null;
  currency: string;
  tax_label: string;
  items: InvoiceItem[];
}

export interface InvoicesPage {
  invoices: InvoiceSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface StockAdjustment {
  id: string;
  quantity_change: number;
  note: string | null;
  reference_number: string | null;
  created_at: string;
  adjusted_by_name: string | null;
  work_order_id: string | null;
  work_order_number: string | null;
}

export interface ReportsData {
  revenueByMonth:     { month: string; revenue: number }[];
  workOrdersByStatus: { status: string; count: number }[];
  topParts:           { name: string; part_number: string | null; total_used: number }[];
  jobsByTechnician:   { name: string; count: number }[];
  meta:               { from: string; to: string };
}
