/**
 * cfo-tax-invoices.routes.test.ts
 *
 * supertest is NOT a dependency of @sangfor/api, so we perform a lightweight
 * route-registration smoke test instead of HTTP-level assertions.
 *
 * Integration smoke tests (POST /tax-invoices/upload-html, GET /tax-invoices)
 * that hit the real DB are gated behind CI_INTEGRATION=1, mirroring the pattern
 * in cfo.integration.test.ts.
 *
 * To run integration tests locally:
 *   CI_INTEGRATION=1 pnpm --filter @sangfor/api test cfo-tax-invoices
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express, { Express } from 'express';
import { createCfoRoutes } from './cfo';

const integration = process.env.CI_INTEGRATION === '1';

// ── Route-registration check (always runs) ──────────────────────────────────
describe('createCfoRoutes – tax-invoice + company-settings route registration', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/cfo', createCfoRoutes());
  });

  it('registers GET /tax-invoices', () => {
    const router = createCfoRoutes() as any;
    const routes: string[] = router.stack
      .filter((l: any) => l.route)
      .map((l: any) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
    expect(routes).toContain('GET /tax-invoices');
  });

  it('registers POST /tax-invoices/upload-html', () => {
    const router = createCfoRoutes() as any;
    const routes: string[] = router.stack
      .filter((l: any) => l.route)
      .map((l: any) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
    expect(routes).toContain('POST /tax-invoices/upload-html');
  });

  it('registers POST /tax-invoices/issue', () => {
    const router = createCfoRoutes() as any;
    const routes: string[] = router.stack
      .filter((l: any) => l.route)
      .map((l: any) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
    expect(routes).toContain('POST /tax-invoices/issue');
  });

  it('registers POST /tax-invoices/:id/transmitted', () => {
    const router = createCfoRoutes() as any;
    const routes: string[] = router.stack
      .filter((l: any) => l.route)
      .map((l: any) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
    expect(routes).toContain('POST /tax-invoices/:id/transmitted');
  });

  it('registers GET /company-settings', () => {
    const router = createCfoRoutes() as any;
    const routes: string[] = router.stack
      .filter((l: any) => l.route)
      .map((l: any) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
    expect(routes).toContain('GET /company-settings');
  });

  it('registers POST /company-settings', () => {
    const router = createCfoRoutes() as any;
    const routes: string[] = router.stack
      .filter((l: any) => l.route)
      .map((l: any) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
    expect(routes).toContain('POST /company-settings');
  });
});

// ── Integration smoke test (CI_INTEGRATION=1 only) ──────────────────────────
describe.skipIf(!integration)(
  'CFO tax-invoice routes – integration (requires live DB)',
  () => {
    // Lazy imports so they don't error out when DB is not available in unit CI.
    let prisma: any;
    let buildSecureMailHtmlForTest: (xml: string, biz: string) => string;
    let SAMPLE_TAXINVOICE_XML: string;
    let setCompanySettings: (input: any) => Promise<any>;
    let ingestSecureMailHtml: (html: string, msgId?: string) => Promise<any>;

    let createdIssueId: string | undefined;

    beforeAll(async () => {
      const dbModule = await import('@sangfor/db');
      prisma = dbModule.prisma;
      const fixtureModule = await import(
        '../services/finance/hometax-securemail/__fixtures__/synthetic'
      );
      buildSecureMailHtmlForTest = fixtureModule.buildSecureMailHtmlForTest;
      SAMPLE_TAXINVOICE_XML = fixtureModule.SAMPLE_TAXINVOICE_XML;
      const csModule = await import('../services/finance/company-settings.service');
      setCompanySettings = csModule.setCompanySettings;
      const inboundModule = await import('../services/finance/tax-invoice-inbound.service');
      ingestSecureMailHtml = inboundModule.ingestSecureMailHtml;

      // Seed company settings so ingest knows our business number
      await setCompanySettings({ businessNumber: '4208702727', companyName: '(주)베를로', ceoName: '박재민' });
    });

    afterAll(async () => {
      // Targeted cleanup — never deleteMany({}) on shared tables
      if (createdIssueId) {
        await prisma.taxInvoice.deleteMany({ where: { issueId: createdIssueId } });
      }
      // Leave CompanySettings 'default' as-is (it's an upsert singleton — do not delete)
    });

    it('POST /tax-invoices/upload-html ingests HTML and returns status created', async () => {
      const html = buildSecureMailHtmlForTest(SAMPLE_TAXINVOICE_XML, '4208702727');
      const result = await ingestSecureMailHtml(html, 'smoke-test-msg-001');
      expect(['created', 'duplicate']).toContain(result.status);
      if (result.status === 'created') {
        // Record issueId for cleanup
        const row = await prisma.taxInvoice.findFirst({ where: { id: result.taxInvoiceId } });
        createdIssueId = row?.issueId;
      }
    });

    it('GET /tax-invoices?direction=purchase returns at least one row', async () => {
      const rows = await prisma.taxInvoice.findMany({
        where: { direction: 'purchase' },
        orderBy: { issueDate: 'desc' },
        take: 200,
      });
      expect(rows.length).toBeGreaterThan(0);
    });
  },
);
