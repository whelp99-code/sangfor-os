export interface NtsTransmitResult { status: 'pending_manual' | 'transmitted'; ref?: string; }
export interface NtsTransmitter { transmit(taxInvoiceId: string): Promise<NtsTransmitResult>; }

// 기본: 자동 전송 안 함(수동 발급 전제). 추후 ASP 어댑터로 교체.
export const manualTransmitter: NtsTransmitter = {
  async transmit() { return { status: 'pending_manual' }; },
};
