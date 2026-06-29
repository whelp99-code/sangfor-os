import { router } from '../trpc';
import { projectsRouter } from './projects.router';
import { invoicesRouter } from './invoices.router';
import { expensesRouter } from './expenses.router';
import { cashflowsRouter } from './cashflows.router';
import { subscriptionsRouter } from './subscriptions.router';
import { ledgerRouter } from './ledger.router';
import { dashboardRouter } from './dashboard.router';
import { monthCloseRouter } from './month-close.router';
import { vatRouter } from './vat.router';
import { popbillRouter } from './popbill.router';
import { codefRouter } from './codef.router';
import { chatbotRouter } from './chatbot.router';
import { notionSyncRouter } from './notion-sync.router';
import { healthRouter } from './health.router';
import { taxInvoicesRouter } from './tax-invoices.router';
import { companySettingsRouter } from './company-settings.router';

export const cfoRouter = router({
  projects: projectsRouter,
  invoices: invoicesRouter,
  expenses: expensesRouter,
  cashflows: cashflowsRouter,
  subscriptions: subscriptionsRouter,
  ledger: ledgerRouter,
  dashboard: dashboardRouter,
  monthClose: monthCloseRouter,
  vat: vatRouter,
  popbill: popbillRouter,
  codef: codefRouter,
  chatbot: chatbotRouter,
  notionSync: notionSyncRouter,
  health: healthRouter,
  taxInvoices: taxInvoicesRouter,
  companySettings: companySettingsRouter,
});
