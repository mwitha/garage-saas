import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { pool } from './db/pool';
import authRouter from './routes/auth';
import customersRouter from './routes/customers';
import { vehiclesRouter, customerVehiclesRouter } from './routes/vehicles';
import workOrdersRouter from './routes/workOrders';
import dashboardRouter from './routes/dashboard';
import usersRouter from './routes/users';
import inventoryRouter from './routes/inventory';
import invoicesRouter from './routes/invoices';
import notificationsRouter from './routes/notifications';
import reportsRouter from './routes/reports';
import faultReportsRouter from './routes/faultReports';
import settingsRouter from './routes/settings';
import employeesRouter from './routes/employees';
import suppliersRouter from './routes/suppliers';
import grnsRouter from './routes/grns';
import permissionsRouter from './routes/permissions';
import expensesRouter from './routes/expenses';
import bankAccountsRouter from './routes/bankAccounts';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(helmet());
const extraOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      callback(null, true);
    } else if (extraOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/customers', customersRouter);
app.use('/api/vehicles', vehiclesRouter);
app.use('/api/customers/:customerId/vehicles', customerVehiclesRouter);
app.use('/api/work-orders', workOrdersRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/users', usersRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/fault-reports', faultReportsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/employees', employeesRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api/grns', grnsRouter);
app.use('/api/permissions', permissionsRouter);
app.use('/api/expenses', expensesRouter);
app.use('/api/bank-accounts', bankAccountsRouter);

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch {
    res.status(500).json({ status: 'error', db: 'disconnected' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});