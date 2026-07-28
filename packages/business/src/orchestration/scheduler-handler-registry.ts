export type HandlerFn = (payload: any) => Promise<{ success: boolean; result?: any; error?: string }>;

const handlerRegistry = new Map<string, HandlerFn>();

export function registerSchedulerHandler(handlerKey: string, fn: HandlerFn) {
  handlerRegistry.set(handlerKey, fn);
}

export function getSchedulerHandler(handlerKey: string): HandlerFn | undefined {
  return handlerRegistry.get(handlerKey);
}

export function hasSchedulerHandler(handlerKey: string): boolean {
  return handlerRegistry.has(handlerKey);
}

// Register default system handlers
registerSchedulerHandler("daily_briefing", async () => ({ success: true, result: { message: "Daily briefing completed" } }));
registerSchedulerHandler("kpi_weekly", async () => ({ success: true, result: { message: "KPI weekly calculated" } }));
