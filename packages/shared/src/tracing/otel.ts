/**
 * OpenTelemetry instrumentation for ai-automation-work-portal
 * 
 * 핵심 API와 백엔드 서비스에 trace를 삽입하여
 * 워크플로우, 프로젝트, 사용자 액션, 승인 상태를 추적합니다.
 */

import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { JaegerExporter } from "@opentelemetry/exporter-jaeger";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  SemanticResourceAttributes,
} from "@opentelemetry/semantic-conventions";
import { trace, SpanStatusCode, SpanKind } from "@opentelemetry/api";

// ─── Provider Setup ───────────────────────────────────────────────
const resource = resourceFromAttributes({
  [SemanticResourceAttributes.SERVICE_NAME]: "ai-automation-work-portal",
  [SemanticResourceAttributes.SERVICE_VERSION]: "1.0.2",
  [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]:
    process.env.NODE_ENV ?? "development",
});

const jaegerExporter = new JaegerExporter({
  endpoint: process.env.JAEGER_ENDPOINT ?? "http://localhost:14268/api/traces",
});

const provider = new NodeTracerProvider({
  resource,
  spanProcessors: [new SimpleSpanProcessor(jaegerExporter)],
});
provider.register();

const tracer = trace.getTracer("ai-automation-work-portal");

// ─── Span Attributes ──────────────────────────────────────────────
export interface WorkflowSpanAttributes {
  workflowId: string;
  projectId?: string;
  userAction: string;
  approvalStatus?: "pending" | "approved" | "rejected" | "skipped";
  module?: string;
  phase?: number;
}

// ─── Workflow Trace Helpers ───────────────────────────────────────
export function traceWorkflow<T>(
  name: string,
  attributes: WorkflowSpanAttributes,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(
    name,
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        "workflow.id": attributes.workflowId,
        "workflow.project_id": attributes.projectId ?? "unknown",
        "workflow.user_action": attributes.userAction,
        "workflow.approval_status": attributes.approvalStatus ?? "none",
        "workflow.module": attributes.module ?? "unknown",
        "workflow.phase": attributes.phase ?? 0,
      },
    },
    async (span) => {
      try {
        const result = await fn();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : "Unknown error",
        });
        span.recordException(
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

// ─── API Route Trace Middleware ───────────────────────────────────
export function traceApiRoute(
  routeName: string,
  attributes: Partial<WorkflowSpanAttributes> = {},
) {
  return tracer.startActiveSpan(
    `api.${routeName}`,
    {
      kind: SpanKind.SERVER,
      attributes: {
        "http.route": routeName,
        "workflow.id": attributes.workflowId ?? "none",
        "workflow.user_action": attributes.userAction ?? "api_call",
        "workflow.module": attributes.module ?? "api",
      },
    },
    (span) => ({
      span,
      end: (error?: Error) => {
        if (error) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message,
          });
          span.recordException(error);
        } else {
          span.setStatus({ code: SpanStatusCode.OK });
        }
        span.end();
      },
    }),
  );
}

// ─── Approval Flow Trace ──────────────────────────────────────────
export function traceApprovalFlow(
  workflowId: string,
  action: string,
  status: "pending" | "approved" | "rejected" | "skipped",
) {
  return tracer.startActiveSpan(
    `approval.${action}`,
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        "workflow.id": workflowId,
        "workflow.user_action": action,
        "workflow.approval_status": status,
      },
    },
    (span) => {
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      return span;
    },
  );
}

export { tracer, provider };
