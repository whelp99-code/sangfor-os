import { Inject, Injectable, Logger } from '@nestjs/common';

export interface ChatTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: any) => Promise<any>;
}

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);
  private readonly tools: ChatTool[] = [];

  constructor(@Inject('PRISMA') private readonly prisma: any) {
    this.registerDefaultTools();
  }

  private registerDefaultTools() {
    this.tools.push({
      name: 'get_month_revenue',
      description: '특정 연/월의 매출 합계(공급가액+세액)와 건수를 조회합니다.',
      parameters: {
        type: 'object',
        properties: { year: { type: 'number' }, month: { type: 'number' } },
        required: ['year', 'month'],
      },
      execute: async ({ year, month }) => {
        const start = new Date(year, month - 1, 1);
        const end = new Date(year, month, 0, 23, 59, 59);
        const rows = await this.prisma.invoice.findMany({
          where: { depositDate: { gte: start, lte: end }, depositStatus: '완료' },
        });
        const total = rows.reduce((s, r) => s + (r.amount ?? 0) + (r.vat ?? 0), 0);
        return { year, month, count: rows.length, totalAmount: Math.round(total) };
      },
    });

    this.tools.push({
      name: 'get_month_expense',
      description: '특정 연/월의 지출 합계와 건수를 조회합니다.',
      parameters: {
        type: 'object',
        properties: { year: { type: 'number' }, month: { type: 'number' } },
        required: ['year', 'month'],
      },
      execute: async ({ year, month }) => {
        const start = new Date(year, month - 1, 1);
        const end = new Date(year, month, 0, 23, 59, 59);
        const rows = await this.prisma.expense.findMany({
          where: { date: { gte: start, lte: end }, isPaid: true },
        });
        const total = rows.reduce((s, r) => s + (r.amount ?? 0) + (r.vat ?? 0), 0);
        return { year, month, count: rows.length, totalAmount: Math.round(total) };
      },
    });

    this.tools.push({
      name: 'list_outstanding_invoices',
      description: '아직 입금되지 않은 미수금 인보이스 목록을 조회합니다.',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const rows = await this.prisma.invoice.findMany({
          where: { depositStatus: { not: '완료' } },
          take: 50,
          orderBy: { depositDate: 'asc' },
        });
        return rows.map((r) => ({
          id: r.id,
          buyer: r.buyer,
          amount: Math.round((r.amount ?? 0) + (r.vat ?? 0)),
          status: r.depositStatus,
        }));
      },
    });

    this.tools.push({
      name: 'category_breakdown',
      description: '지출 카테고리별 합산을 조회합니다.',
      parameters: {
        type: 'object',
        properties: { year: { type: 'number' }, month: { type: 'number' } },
      },
      execute: async ({ year, month }) => {
        const where: any = { isPaid: true };
        if (year && month) {
          const start = new Date(year, month - 1, 1);
          const end = new Date(year, month, 0, 23, 59, 59);
          where.date = { gte: start, lte: end };
        }
        const rows = await this.prisma.expense.findMany({ where });
        const map: Record<string, number> = {};
        for (const r of rows) {
          const cat = r.category ?? '기타';
          map[cat] = (map[cat] ?? 0) + (r.amount ?? 0) + (r.vat ?? 0);
        }
        return Object.entries(map)
          .map(([category, amount]) => ({ category, amount: Math.round(amount) }))
          .sort((a, b) => b.amount - a.amount);
      },
    });

    this.tools.push({
      name: 'subscription_monthly',
      description: '현재 활성 구독의 월 합산 비용을 조회합니다.',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const subs = await this.prisma.subscription.findMany({ where: { isActive: true } });
        let total = 0;
        for (const s of subs) {
          if (s.cycle === 'monthly') total += s.amount;
          else if (s.cycle === 'yearly') total += s.amount / 12;
          else if (s.cycle === 'weekly') total += s.amount * 4.345;
        }
        return { monthlyTotal: Math.round(total), count: subs.length };
      },
    });

    this.tools.push({
      name: 'vat_payable',
      description: '특정 연/월의 예상 부가세 납부액을 계산합니다 (1기/2기 통합).',
      parameters: {
        type: 'object',
        properties: { year: { type: 'number' }, half: { type: 'number', enum: [1, 2] } },
        required: ['year', 'half'],
      },
      execute: async ({ year, half }) => {
        const start = new Date(year, half === 1 ? 0 : 6, 1);
        const end = new Date(year, half === 1 ? 5 : 11, 31, 23, 59, 59);
        const sales = await this.prisma.taxInvoice.aggregate({
          where: { direction: 'sales', issueDate: { gte: start, lte: end } },
          _sum: { vatAmount: true },
        });
        const purchase = await this.prisma.taxInvoice.aggregate({
          where: { direction: 'purchase', issueDate: { gte: start, lte: end } },
          _sum: { vatAmount: true },
        });
        const salesVat = sales._sum.vatAmount ?? 0;
        const purchaseVat = purchase._sum.vatAmount ?? 0;
        return {
          year,
          half,
          salesVat: Math.round(salesVat),
          purchaseVat: Math.round(purchaseVat),
          payable: Math.round(Math.max(0, salesVat - purchaseVat)),
        };
      },
    });
  }

  listTools() {
    return this.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
  }

  async executeTool(name: string, args: any) {
    const tool = this.tools.find((t) => t.name === name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    try {
      const result = await tool.execute(args ?? {});
      return { ok: true, result };
    } catch (e: any) {
      this.logger.error(`Tool ${name} failed: ${e?.message ?? e}`);
      return { ok: false, error: e?.message ?? String(e) };
    }
  }

  /**
   * 의도 분류 (간단한 키워드 기반)
   * OpenAI 키가 없으면 로컬 라우팅으로 fallback
   */
  classifyIntent(message: string): { tool: string; args: Record<string, any> } | null {
    const m = message.toLowerCase();
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    if (/(매출|수익|입금).*(이번달|이번|현재|6월|7월|\d월)/.test(message)) {
      return { tool: 'get_month_revenue', args: { year, month } };
    }
    if (/(지출|비용|쓴돈|사용).*(이번달|이번|현재|\d월)/.test(message)) {
      return { tool: 'get_month_expense', args: { year, month } };
    }
    if (/(미수금|미입금|미납|체납|정리)/.test(message)) {
      return { tool: 'list_outstanding_invoices', args: {} };
    }
    if (/(구독|월구독|월정액|saas)/.test(message)) {
      return { tool: 'subscription_monthly', args: {} };
    }
    if (/(부가세|vat|세금).*(얼마|예상|납부)/.test(message)) {
      const half = month <= 6 ? 1 : 2;
      return { tool: 'vat_payable', args: { year, half } };
    }
    if (/(카테고리|분류).*(지출|비용|현황)/.test(message)) {
      return { tool: 'category_breakdown', args: { year, month } };
    }
    return null;
  }

  /**
   * OpenAI Function Calling when OPENAI_API_KEY is set; else keyword routing.
   */
  async chat(message: string, history: { role: string; content: string }[] = []) {
    const openAiKey = process.env.OPENAI_API_KEY?.trim();
    if (openAiKey) {
      const ai = await this.chatWithOpenAi(message, history, openAiKey).catch((e) => {
        this.logger.warn(`OpenAI fallback to keywords: ${e?.message}`);
        return null;
      });
      if (ai) return ai;
    }

    const intent = this.classifyIntent(message);

    if (!intent) {
      return {
        reply: this.fallbackReply(message),
        tool: null,
        toolResult: null,
      };
    }

    const exec = await this.executeTool(intent.tool, intent.args);
    if (!exec.ok) {
      return { reply: `데이터 조회 중 오류: ${exec.error}`, tool: intent.tool, toolResult: null };
    }

    return {
      reply: this.formatToolResult(intent.tool, exec.result, message),
      tool: intent.tool,
      toolResult: exec.result,
    };
  }

  private fallbackReply(message: string): string {
    if (/(안녕|hi|hello)/i.test(message)) {
      return '안녕하세요! CFO AI 어시스턴트입니다. 매출/지출, 미수금, 부가세, 구독 등에 대해 물어보세요.';
    }
    return '죄송합니다. 다음 중 하나를 물어보실 수 있어요:\n• 이번 달 매출/지출은?\n• 미수금 인보이스 목록\n• 부가세 얼마?\n• 구독 월 비용\n• 카테고리별 지출';
  }

  private formatToolResult(tool: string, data: any, originalQuestion: string): string {
    switch (tool) {
      case 'get_month_revenue':
        return `이번 달(${data.year}년 ${data.month}월) 매출은 **${(data.totalAmount ?? 0).toLocaleString()}원** (${data.count}건)입니다.`;
      case 'get_month_expense':
        return `이번 달(${data.year}년 ${data.month}월) 지출은 **${(data.totalAmount ?? 0).toLocaleString()}원** (${data.count}건)입니다.`;
      case 'list_outstanding_invoices': {
        if (!data?.length) return '미수금 인보이스가 없습니다. 모든 결제가 완료되었어요!';
        const total = data.reduce((s, r) => s + r.amount, 0);
        return `미수금 인보이스 ${data.length}건, 합계 **${total.toLocaleString()}원**입니다.\n주요 거래처: ${data.slice(0, 5).map((d) => d.buyer ?? '미상').join(', ')}`;
      }
      case 'subscription_monthly':
        return `현재 활성 구독 ${data.count}건, 월 환산 비용은 **${(data.monthlyTotal ?? 0).toLocaleString()}원**입니다.`;
      case 'category_breakdown': {
        if (!data?.length) return '지출 데이터가 없습니다.';
        const top = data.slice(0, 5).map((d) => `${d.category} ${d.amount.toLocaleString()}원`).join('\n');
        return `카테고리별 지출 합계:\n${top}`;
      }
      case 'vat_payable':
        return `${data.year}년 ${data.half}기 예상 부가세: **${(data.payable ?? 0).toLocaleString()}원**\n(매출세액 ${(data.salesVat ?? 0).toLocaleString()} - 매입세액 ${(data.purchaseVat ?? 0).toLocaleString()})`;
      default:
        return JSON.stringify(data, null, 2);
    }
  }

  // 세션/메시지 저장
  async createSession(title = '새 대화') {
    return this.prisma.chatSession.create({ data: { title } });
  }

  async listSessions() {
    return this.prisma.chatSession.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
  }

  async getMessages(sessionId: string) {
    return this.prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async sendMessage(sessionId: string, content: string) {
    // 사용자 메시지 저장
    await this.prisma.chatMessage.create({
      data: { sessionId, role: 'user', content },
    });
    // 응답 생성
    const result = await this.chat(content);
    // 어시스턴트 메시지 저장
    await this.prisma.chatMessage.create({
      data: {
        sessionId,
        role: 'assistant',
        content: result.reply,
        toolName: result.tool,
        toolResult: result.toolResult ? JSON.stringify(result.toolResult) : null,
      },
    });
    // 세션 updatedAt 갱신
    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });
    return result;
  }

  private async chatWithOpenAi(
    message: string,
    history: { role: string; content: string }[],
    apiKey: string,
  ) {
    const tools = this.listTools().map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const messages = [
      {
        role: 'system' as const,
        content:
          'You are a Korean CFO assistant. Use tools for revenue, expenses, VAT, subscriptions, outstanding invoices. Reply in Korean.',
      },
      ...history.slice(-6).map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content })),
      { role: 'user' as const, content: message },
    ];

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
        messages,
        tools,
        tool_choice: 'auto',
      }),
    });

    if (!res.ok) {
      throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as any;
    const choice = data.choices?.[0]?.message;
    if (!choice) {
      return { reply: this.fallbackReply(message), tool: null, toolResult: null };
    }

    const toolCall = choice.tool_calls?.[0];
    if (toolCall?.function?.name) {
      const args = JSON.parse(toolCall.function.arguments ?? '{}');
      const exec = await this.executeTool(toolCall.function.name, args);
      if (!exec.ok) {
        return { reply: `데이터 조회 중 오류: ${exec.error}`, tool: toolCall.function.name, toolResult: null };
      }
      return {
        reply: this.formatToolResult(toolCall.function.name, exec.result, message),
        tool: toolCall.function.name,
        toolResult: exec.result,
      };
    }

    return {
      reply: choice.content ?? this.fallbackReply(message),
      tool: null,
      toolResult: null,
    };
  }
}
