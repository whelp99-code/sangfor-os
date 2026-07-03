import { describe, it, expect } from 'vitest';
import { computePnl } from './domain-pnl';

describe('computePnl', () => {
  it('revenue = sales invoices + sales tax invoices; cost = purchase tax invoices; margin = revenue - purchase - expense', () => {
    const r = computePnl({
      invoices: [{ total: 1_100_000 }],
      expenses: [{ total: 200_000 }],
      taxInvoices: [
        { direction: 'purchase', totalAmount: 572_000 },
        { direction: 'sales', totalAmount: 0 },
      ],
    });
    expect(r.revenue).toBe(1_100_000);
    expect(r.purchase).toBe(572_000);
    expect(r.expense).toBe(200_000);
    expect(r.margin).toBe(328_000);
    expect(r.marginPct).toBe(29.8); // round(328000/1100000*1000)/10
  });
  it('handles empty (0/0/0) without divide-by-zero', () => {
    const r = computePnl({ invoices: [], expenses: [], taxInvoices: [] });
    expect(r).toEqual({ revenue: 0, purchase: 0, expense: 0, margin: 0, marginPct: 0 });
  });
});
