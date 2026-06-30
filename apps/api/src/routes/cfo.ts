import { Router } from 'express';
import { DashboardService, InvoicesService, ExpensesService, CashflowsService, SubscriptionsService, LedgerService, ProjectsService, MonthCloseService, VatService, PopbillService, CodefService, ChatbotService, NotionSyncService, HealthService } from '../services/finance';
import { ingestSecureMailHtml } from '../services/finance/tax-invoice-inbound.service';
import { issueSalesTaxInvoice, markTransmitted } from '../services/finance/tax-invoice-issue.service';
import { setCompanySettings } from '../services/finance/company-settings.service';
import { prisma } from '@sangfor/db';

const router = Router();
const healthRouter = Router();

const dashboard = new DashboardService();
const invoices = new InvoicesService();
const expenses = new ExpensesService();
const cashflows = new CashflowsService();
const subscriptions = new SubscriptionsService();
const ledger = new LedgerService();
const projects = new ProjectsService();
const monthClose = new MonthCloseService();
const vat = new VatService();
const popbill = new PopbillService();
const codef = new CodefService();
const chatbot = new ChatbotService();
const notion = new NotionSyncService();
const health = new HealthService();

function ok(handler: (...args: any[]) => any) {
  return async (req: any, res: any) => {
    try {
      const result = await handler(req);
      res.json(result);
    } catch (e: any) {
      // Sanitize errors: only validated client-input errors (BadRequestError)
      // expose their user-facing message. Everything else (Prisma stack, schema
      // names, internal failures) is generalized to avoid leaking internals.
      if (e instanceof BadRequestError) {
        res.status(400).json({ error: e.message });
        return;
      }
      console.error('[cfo] unhandled error:', e);
      res.status(500).json({ error: '요청을 처리할 수 없습니다.' });
    }
  };
}

function q(req: any, name: string, def?: any) {
  return req.query[name] ?? def;
}

function num(q: any) {
  const n = Number(q);
  return isNaN(n) ? undefined : n;
}

function date(q: any) {
  return q ? new Date(q) : undefined;
}

// 400을 일반 메시지로 던지는 클라이언트 입력 오류. ok()가 그대로 4xx body로 노출하므로
// Prisma/스택 누출 없이 사용자향 메시지만 전달된다.
export class BadRequestError extends Error {}

/** VAT 등에서 year를 정수로 강제. NaN이면 400 (예: year=abc가 Prisma 스택을 노출하던 문제 차단). */
export function requireYear(raw: any): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1900 || n > 9999) {
    throw new BadRequestError('year는 유효한 연도여야 합니다');
  }
  return n;
}

/** 부가세 반기(half)는 1 또는 2만 허용. 그 외(half=3 등)는 400. */
export function requireHalf(raw: any): 1 | 2 {
  const n = Number(raw);
  if (n !== 1 && n !== 2) {
    throw new BadRequestError('half는 1 또는 2여야 합니다');
  }
  return n as 1 | 2;
}

// Dashboard
router.get('/dashboard/kpi', ok((req: any) => {
  const now = new Date();
  return dashboard.getKpi(num(q(req, 'year')) ?? now.getFullYear(), num(q(req, 'month')) ?? now.getMonth() + 1);
}));
router.get('/dashboard/cashflow-forecast', ok((req: any) => dashboard.getCashflowForecast(num(q(req, 'days')) ?? 90)));
router.get('/dashboard/monthly-trend', ok((req: any) => dashboard.getMonthlyTrend(num(q(req, 'months')) ?? 6)));

// Invoices
router.get('/invoices', ok((req: any) => invoices.list({
  depositStatus: q(req, 'depositStatus'), projectId: q(req, 'projectId'), limit: num(q(req, 'limit')) ?? 100,
})));
router.get('/invoices/:id', ok((req: any) => invoices.get(req.params.id)));
router.post('/invoices', ok((req: any) => invoices.create(req.body)));
router.patch('/invoices/:id', ok((req: any) => invoices.update(req.params.id, req.body)));
router.delete('/invoices/:id', ok((req: any) => invoices.delete(req.params.id)));

// Expenses
router.get('/expenses', ok((req: any) => expenses.list({
  category: q(req, 'category'), isPaid: q(req, 'isPaid') === undefined ? undefined : q(req, 'isPaid') === 'true', projectId: q(req, 'projectId'), limit: num(q(req, 'limit')) ?? 100,
})));
router.get('/expenses/:id', ok((req: any) => expenses.get(req.params.id)));
router.post('/expenses', ok((req: any) => expenses.create(req.body)));
router.patch('/expenses/:id', ok((req: any) => expenses.update(req.params.id, req.body)));
router.delete('/expenses/:id', ok((req: any) => expenses.delete(req.params.id)));

// Cashflows
router.get('/cashflows', ok((req: any) => cashflows.list({
  type: q(req, 'type'), projectId: q(req, 'projectId'), limit: num(q(req, 'limit')) ?? 100,
})));
router.get('/cashflows/:id', ok((req: any) => cashflows.get(req.params.id)));
router.post('/cashflows/import', ok((req: any) => cashflows.importMany(req.body.rows ?? [])));
router.post('/cashflows/rematch', ok(() => cashflows.rematchAll()));
router.post('/cashflows', ok((req: any) => cashflows.create(req.body)));
router.patch('/cashflows/:id', ok((req: any) => cashflows.update(req.params.id, req.body)));
router.delete('/cashflows/:id', ok((req: any) => cashflows.delete(req.params.id)));

// Subscriptions
router.get('/subscriptions', ok((req: any) => subscriptions.list({
  isActive: q(req, 'isActive') === undefined ? undefined : q(req, 'isActive') === 'true',
})));
router.post('/subscriptions', ok((req: any) => subscriptions.create(req.body)));
router.patch('/subscriptions/:id', ok((req: any) => subscriptions.update(req.params.id, req.body)));
router.delete('/subscriptions/:id', ok((req: any) => subscriptions.remove(req.params.id)));
router.post('/subscriptions/:id/advance', ok((req: any) => subscriptions.advanceCycle(req.params.id)));
router.get('/subscriptions/summary/monthly', ok(() => subscriptions.getTotalMonthlyCost()));
router.get('/subscriptions/summary/by-category', ok(() => subscriptions.getCategoryBreakdown()));
router.get('/subscriptions/upcoming', ok((req: any) => subscriptions.getUpcomingRenewals(num(q(req, 'days')) ?? 7)));

// Ledger
router.get('/ledger/entries', ok((req: any) => ledger.listEntries({ from: date(q(req, 'from')), to: date(q(req, 'to')), limit: num(q(req, 'limit')) })));
router.get('/ledger/accounts', ok((req: any) => ledger.getAccountBalances({ from: date(q(req, 'from')), to: date(q(req, 'to')) })));
router.get('/ledger/trial-balance', ok((req: any) => ledger.getTrialBalance({ from: date(q(req, 'from')), to: date(q(req, 'to')) })));
router.get('/ledger/pnl', ok((req: any) => ledger.getProfitAndLoss({ from: date(q(req, 'from')), to: date(q(req, 'to')) })));

// Projects
router.get('/projects', ok((req: any) => projects.list({ status: q(req, 'status'), limit: num(q(req, 'limit')) ?? 100 })));
router.get('/deals-pnl', ok(() => projects.listDealPnl())); // ADR-001 Phase 2b: deal-level P&L
router.post('/projects', ok((req: any) => projects.create(req.body)));
router.get('/projects/:id', ok((req: any) => projects.get(req.params.id)));

// Month Close
router.get('/month-close', ok(() => monthClose.list()));
router.get('/month-close/checklist', ok((req: any) => monthClose.runChecklist(Number(q(req, 'year')), Number(q(req, 'month')))));
router.get('/month-close/:year/:month', ok((req: any) => monthClose.get(Number(req.params.year), Number(req.params.month))));
router.post('/month-close/:year/:month/start', ok((req: any) => monthClose.start(Number(req.params.year), Number(req.params.month), req.body?.notes)));
router.post('/month-close/:year/:month/complete', ok((req: any) => monthClose.complete(Number(req.params.year), Number(req.params.month))));

// VAT
router.get('/vat/calculate', ok((req: any) => vat.calculateVat(requireYear(q(req, 'year')), requireHalf(q(req, 'half')))));
router.post('/vat/income-tax', ok((req: any) => vat.calculateIncomeTax(req.body?.taxableBase ?? 0)));
router.get('/vat/periods', ok((req: any) => vat.getPeriodBounds(requireYear(q(req, 'year')), requireHalf(q(req, 'half')))));

// Popbill
router.get('/popbill/status', ok(() => popbill.checkStatus()));
router.post('/popbill/issue', ok((req: any) => popbill.issue({ ...req.body, issueDate: new Date(req.body.issueDate) })));
router.post('/popbill/collect-purchase', ok((req: any) => popbill.collectPurchaseTaxInvoices(req.body.year, req.body.month)));
router.get('/popbill/history', ok((req: any) => popbill.listHistory({ direction: q(req, 'direction'), status: q(req, 'status'), limit: num(q(req, 'limit')) })));
router.get('/popbill/biz-check/:corpNum', ok((req: any) => popbill.checkBizInfo(req.params.corpNum)));

// CODEF
router.get('/codef/status', ok(() => ({ enabled: codef.isEnabled() })));
router.get('/codef/accounts', ok((req: any) => codef.listAccounts(q(req, 'type'))));
router.post('/codef/accounts/connect', ok((req: any) => codef.connectAccount(req.body)));
router.post('/codef/accounts/:id/sync', ok((req: any) => codef.syncTransactions(req.params.id, new Date(q(req, 'fromDate')), new Date(q(req, 'toDate')))));
router.get('/codef/expiring', ok((req: any) => codef.getExpiringSoon(num(q(req, 'days')) ?? 7)));

// Chatbot
router.get('/chatbot/tools', ok(() => chatbot.listTools()));
router.post('/chatbot/chat', ok((req: any) => chatbot.chat(req.body.message, req.body.history)));
router.post('/chatbot/sessions', ok((req: any) => chatbot.createSession(req.body?.title)));
router.get('/chatbot/sessions', ok(() => chatbot.listSessions()));
router.get('/chatbot/sessions/:id/messages', ok((req: any) => chatbot.getMessages(req.params.id)));
router.post('/chatbot/sessions/:id/messages', ok((req: any) => chatbot.sendMessage(req.params.id, req.body.content)));

// Notion Sync
router.get('/notion-sync/status', ok(() => notion.status()));
router.post('/notion-sync/csv-import', ok(() => notion.triggerCsvImport()));

// Tax Invoices
router.get('/tax-invoices', ok((req: any) => {
  const direction = q(req, 'direction');
  return prisma.taxInvoice.findMany({
    where: direction ? { direction } : {},
    orderBy: { issueDate: 'desc' },
    take: num(q(req, 'limit')) ?? 200,
    // Keep the list payload lean — internal columns (decrypted XML, raw API
    // response) are not needed by the table and shouldn't ship to the client.
    omit: { rawXml: true, rawResponse: true },
  });
}));
router.post('/tax-invoices/upload-html', ok((req: any) => ingestSecureMailHtml(req.body.html, req.body.sourceMessageId)));
router.post('/tax-invoices/issue', ok((req: any) => issueSalesTaxInvoice(req.body)));
router.post('/tax-invoices/:id/transmitted', ok((req: any) => markTransmitted(req.params.id)));

// Company Settings
router.get('/company-settings', ok(async () => {
  const s = await prisma.companySettings.findUnique({ where: { id: 'default' } });
  return { businessNumber: s?.businessNumber ?? '', companyName: s?.companyName, ceoName: s?.ceoName };
}));
router.post('/company-settings', ok((req: any) => setCompanySettings(req.body)));

// Health
router.get('/health', ok(() => health.check()));
router.get('/health/ready', ok(() => health.ready()));
healthRouter.get('/health', ok(() => health.check()));
healthRouter.get('/health/ready', ok(() => health.ready()));

export function createCfoHealthRoutes(): Router {
  return healthRouter;
}

export function createCfoRoutes(): Router {
  return router;
}
