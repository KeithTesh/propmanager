// api/src/server.ts

import 'dotenv/config';
import 'express-async-errors';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import path from 'path';
import rateLimit from 'express-rate-limit';

import { logger } from './lib/logger';
import { globalErrorHandler } from './lib/errors';
import { authenticate, requireSetupComplete } from './middleware/auth';
import { loadCaretakerPerms, blockCaretaker } from './middleware/caretaker';
import { requireActiveSubscription } from './middleware/subscription';
import { checkDatabaseHealth, closeDatabaseConnections } from './db';
import { checkRedisHealth, closeRedisConnection } from './db/redis';
import { scheduleBillingCron } from './jobs/billing.cron';
import { runTrialReminderCron } from './jobs/trial.cron';

// ─── ROUTERS ──────────────────────────────────────────────────────────────────

import { authRouter }           from './modules/auth/auth.router';
import { companiesRouter }      from './modules/companies/companies.router';
import { propertiesRouter }     from './modules/properties/properties.router';
import { unitsRouter }          from './modules/units/units.router';
import { tenantsRouter }        from './modules/tenants/tenants.router';
import { leasesRouter }         from './modules/leases/leases.router';
import { billingRouter }        from './modules/billing/billing.router';
import { paymentsRouter }       from './modules/payments/payments.router';
import { reconciliationRouter } from './modules/reconciliation/reconciliation.router';
import { maintenanceRouter }    from './modules/maintenance/maintenance.router';
import { expensesRouter }       from './modules/expenses/expenses.router';
import { notificationsRouter }  from './modules/notifications/notifications.router';
import { dashboardRouter }      from './modules/dashboard/dashboard.router';
import { reportsRouter }        from './modules/reports/reports.router';
import { auditRouter }          from './modules/audit/audit.router';
import { portalRouter }         from './modules/portal/portal.router';
import { staffRouter }          from './modules/staff/staff.router';
import { payrollRouter }        from './modules/payroll/payroll.router';
import { governanceRouter }     from './modules/governance/governance.router';
import { alertsRouter }    from './modules/notifications/alerts.router';
import { smsRouter }            from './modules/sms/sms.router';
import { landlordsRouter }      from './modules/landlords/landlords.router';
import { remittancesRouter }    from './modules/remittances/remittances.router';
import { landlordPortalRouter } from './modules/landlord-portal/landlord-portal.router';
import { superAdminRouter }       from './modules/superadmin/superadmin.router';
import { registerRouter }         from './modules/auth/register.router';
import { subscriptionRouter }     from './modules/subscription/subscription.router';

const app  = express();
const PORT = Number(process.env.PORT ?? 4000);

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────

app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", 'cdnjs.cloudflare.com'],
      styleSrc:   ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
      fontSrc:    ["'self'", 'fonts.gstatic.com'],
      imgSrc:     ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https://api.anthropic.com', 'https://sandbox.intasend.com', 'https://payment.intasend.com'],
    },
  },
}));
const ALLOWED_ORIGINS = (process.env.WEB_BASE_URL ?? 'http://localhost:3000')
  .split(',')
  .map(o => o.trim())
  .concat(['http://localhost:5000']); // marketing site

app.use(cors({
  origin: (origin, cb) => {
    // allow requests with no origin (curl, mobile apps, etc.)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials:    true,
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(compression());

// ─── RATE LIMITING ────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                   // 20 attempts per window
  message: { success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Too many attempts. Please try again in 15 minutes.' } },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,                   // 10 registrations per hour per IP
  message: { success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Too many registrations from this IP. Please try again later.' } },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300,            // 300 requests per minute per IP
  message: { success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests. Please slow down.' } },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.ctx?.userRole === 'super_admin', // super admin bypasses
});
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────

app.get('/health', async (_req, res) => {
  const [db, redis] = await Promise.all([checkDatabaseHealth(), checkRedisHealth()]);
  const healthy = db && redis;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    services: { database: db ? 'ok' : 'error', redis: redis ? 'ok' : 'error' },
  });
});

// ─── PUBLIC ROUTES (no auth required) ────────────────────────────────────────

app.use('/api/v1/auth/login',        authLimiter);
app.use('/api/v1/auth/register',     registerLimiter);
app.use('/api/v1/auth',              authRouter);       // login, refresh, logout
app.use('/api/v1/auth',              registerRouter);   // /register, /settings
app.use('/api/v1/webhooks/intasend', subscriptionRouter); // IntaSend payment webhook

// ─── PROTECTED API ────────────────────────────────────────────────────────────

const api = express.Router();
api.use(apiLimiter);

api.use(authenticate);
api.use(requireSetupComplete);
api.use(loadCaretakerPerms); // loads property scope for caretaker + manager roles
api.use(requireActiveSubscription); // blocks suspended/cancelled companies

api.use('/superadmin',     superAdminRouter);
api.use('/companies',      companiesRouter);
api.use('/properties',     propertiesRouter);
api.use('/units',          unitsRouter);
api.use('/tenants',        tenantsRouter);
api.use('/leases',         blockCaretaker,  leasesRouter);
api.use('/billing',        blockCaretaker,  billingRouter);
api.use('/payments',       blockCaretaker,  paymentsRouter);
api.use('/reconciliation', blockCaretaker,  reconciliationRouter);
api.use('/maintenance',    maintenanceRouter);     // caretaker allowed
api.use('/expenses',       blockCaretaker,  expensesRouter);
api.use('/notifications',  notificationsRouter);  // caretaker allowed
api.use('/dashboard',      dashboardRouter);       // caretaker allowed (scoped)
api.use('/reports',        blockCaretaker,  reportsRouter);
api.use('/audit',          blockCaretaker,  auditRouter);
api.use('/portal',         portalRouter);          // tenant only (enforced inside)
api.use('/staff',          staffRouter);            // owner + manager
api.use('/payroll',        blockCaretaker,  payrollRouter);
api.use('/governance',     blockCaretaker,  governanceRouter);
api.use('/alerts',     alertsRouter);
api.use('/sms',            blockCaretaker,  smsRouter);
api.use('/landlords',      blockCaretaker,  landlordsRouter);
api.use('/remittances',    blockCaretaker,  remittancesRouter);
api.use('/landlord-portal', landlordPortalRouter);  // landlord_client role — no other guards
api.use('/subscription',   subscriptionRouter); // subscription status + pay (company owner)

app.use('/api/v1', api);

// ─── ERROR HANDLERS ───────────────────────────────────────────────────────────

app.use(globalErrorHandler);
app.use((_req, res) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

// ─── STARTUP ──────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  const dbHealthy = await checkDatabaseHealth();
  if (!dbHealthy) { logger.fatal('Cannot connect to database — aborting startup'); process.exit(1); }

  const redisHealthy = await checkRedisHealth();
  if (!redisHealthy) logger.warn('Redis unavailable — degraded mode');

  app.listen(PORT, () => {
    logger.info({ port: PORT, env: process.env.NODE_ENV }, 'PropManager API started');
  });

  scheduleBillingCron();

  // Trial reminder cron — daily at 09:00 Nairobi
  const cron = await import('node-cron');
  cron.default.schedule('0 9 * * *', () => runTrialReminderCron(), { timezone: 'Africa/Nairobi' });

  logger.info('Billing + trial cron jobs scheduled');
}

// ─── GRACEFUL SHUTDOWN ────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutdown signal received');
  await Promise.all([closeDatabaseConnections(), closeRedisConnection()]);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('uncaughtException',  (err)    => { logger.fatal({ err }, 'Uncaught exception');    process.exit(1); });
process.on('unhandledRejection', (reason) => { logger.fatal({ reason }, 'Unhandled rejection'); process.exit(1); });

start();

// ─── MARKETING WEBSITE SERVER (dev only — port 5000) ─────────────────────────
// Serves the static marketing site separately so it doesn't conflict with
// the React app at localhost:3000. In production, host this on a CDN or
// separate domain (e.g. propmanager.co.ke vs app.propmanager.co.ke) — a second
// listener here would confuse host platforms (Render etc.) that expect a
// single bound port per service.

if (process.env.NODE_ENV !== 'production') {
  const WEBSITE_PORT = Number(process.env.WEBSITE_PORT ?? 5000);
  const websiteApp = express();
  websiteApp.use(express.static(path.join(__dirname, '..', 'public')));
  websiteApp.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });
  websiteApp.listen(WEBSITE_PORT, () => {
    logger.info({ port: WEBSITE_PORT }, 'Marketing website server started');
  });
}

export { app };