function generateId(): string {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36)
}

export interface Span {
  traceId: string
  spanId: string
  parentSpanId?: string
  operationName: string
  startTime: number
  endTime?: number
  tags: Record<string, string>
}

export class Tracer {
  private spans: Span[] = []

  startSpan(operationName: string, parentSpanId?: string): Span {
    let traceId = generateId()
    if (parentSpanId) {
      const parent = this.spans.find((s) => s.spanId === parentSpanId)
      if (parent) {
        traceId = parent.traceId
      }
    }
    const span: Span = {
      traceId,
      spanId: generateId(),
      parentSpanId,
      operationName,
      startTime: Date.now(),
      tags: {},
    }
    this.spans.push(span)
    return span
  }

  endSpan(spanId: string, tags?: Record<string, string>): Span {
    const span = this.spans.find((s) => s.spanId === spanId)
    if (!span) {
      throw new Error(`Span not found: ${spanId}`)
    }
    span.endTime = Date.now()
    if (tags) {
      Object.assign(span.tags, tags)
    }
    return span
  }

  getTrace(traceId: string): Span[] {
    return this.spans.filter((s) => s.traceId === traceId)
  }

  getAllSpans(): Span[] {
    return [...this.spans]
  }

  reset(): void {
    this.spans = []
  }
}
