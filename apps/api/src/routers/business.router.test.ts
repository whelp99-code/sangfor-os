import { describe, expect, it } from 'vitest';
import { businessRouter } from './business.router';

/**
 * P3 follow-on: business.router.ts had 0 role guards on any procedure.
 * createQuote / submitQuoteForApproval / completeDelivery are now gated to
 * specific commercial/delivery roles. The role middleware rejects before the
 * resolver touches Prisma, so these don't need a live DB.
 */
describe('businessRouter — role gates on commercial mutations', () => {
  const outsiderCaller = businessRouter.createCaller({
    userId: 'test-user',
    userRole: 'support_engineer',
    companyId: 'company-1',
  } as any);

  it('rejects createQuote for a role outside the commercial set', async () => {
    await expect(
      outsiderCaller.createQuote({ opportunityId: 'opp-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects submitQuoteForApproval for a role outside the commercial set', async () => {
    await expect(
      outsiderCaller.submitQuoteForApproval({
        quoteId: 'quote-1',
        opportunityId: 'opp-1',
        reason: 'test',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects completeDelivery for a role outside the delivery set', async () => {
    await expect(
      outsiderCaller.completeDelivery({
        deliveryId: 'delivery-1',
        assetName: 'asset-1',
        customerId: 'customer-1',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects an unauthenticated caller with UNAUTHORIZED, not FORBIDDEN', async () => {
    const anonCaller = businessRouter.createCaller({ userId: null, userRole: null } as any);
    await expect(
      anonCaller.createQuote({ opportunityId: 'opp-1' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
