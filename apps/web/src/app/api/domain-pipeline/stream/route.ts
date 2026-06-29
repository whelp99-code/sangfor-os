import { prisma } from "@sangfor/db";
import {
  buildDomainDashboardSnapshot,
  createPrismaDomainStatsLoader,
} from "@sangfor/business";

/**
 * 종축 도메인 대시보드 실시간 스트림 (Server-Sent Events).
 *
 * 연결 즉시 1회 + 이후 주기적으로 스냅샷을 push 한다. 직전과 동일하면 보내지 않아
 * 트래픽을 줄인다. 클라이언트는 EventSource 로 구독한다.
 */

export const dynamic = "force-dynamic";

const INTERVAL_MS = 5000;

export async function GET(request: Request) {
  const loader = createPrismaDomainStatsLoader(prisma as never, "demo-project");
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let lastFingerprint = "";

      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const push = async () => {
        try {
          const snapshot = await buildDomainDashboardSnapshot(loader);
          // generatedAt 을 뺀 내용으로 변화 감지 → 동일하면 skip(heartbeat 만).
          const fingerprint = JSON.stringify({ rows: snapshot.rows, totals: snapshot.totals });
          if (fingerprint !== lastFingerprint) {
            lastFingerprint = fingerprint;
            send("snapshot", snapshot);
          } else {
            send("heartbeat", { at: snapshot.generatedAt });
          }
        } catch (error) {
          send("error", { message: error instanceof Error ? error.message : "stream_failed" });
        }
      };

      await push(); // 즉시 1회
      const timer = setInterval(push, INTERVAL_MS);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
