export interface PnlInput {
  invoices: { total: number }[];
  expenses: { total: number }[];
  taxInvoices: { direction: string; totalAmount: number }[];
}

export interface Pnl {
  revenue: number;
  purchase: number;
  expense: number;
  margin: number;
  marginPct: number;
}

const sum = (ns: number[]) => ns.reduce((s, n) => s + (n || 0), 0);

export function computePnl(input: PnlInput): Pnl {
  const salesTaxInvoiceTotal = sum(
    input.taxInvoices.filter((t) => t.direction === 'sales').map((t) => t.totalAmount),
  );
  const revenue = sum(input.invoices.map((i) => i.total)) + salesTaxInvoiceTotal;
  const purchase = sum(
    input.taxInvoices.filter((t) => t.direction === 'purchase').map((t) => t.totalAmount),
  );
  const expense = sum(input.expenses.map((e) => e.total));
  const margin = revenue - purchase - expense;
  const marginPct = revenue > 0 ? Math.round((margin / revenue) * 1000) / 10 : 0;
  return { revenue, purchase, expense, margin, marginPct };
}
