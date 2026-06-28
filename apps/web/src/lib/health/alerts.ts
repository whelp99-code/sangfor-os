import type { Transition } from "./history-store";

export interface AlertOptions {
  webhookUrl?: string;
  fetchImpl?: typeof fetch;
}

function formatTransition(t: Transition): string {
  const arrow = t.to === "healthy" ? "✅ 복구" : "⚠️ 장애";
  return `${arrow} ${t.id}: ${t.from} → ${t.to}`;
}

/**
 * Notify Slack of healthiness-flip transitions. No-op (sent:false) when no
 * webhook is configured, so it is safe to call unconditionally on every probe.
 */
export async function notifyTransitions(
  transitions: Transition[],
  opts: AlertOptions = {},
): Promise<{ sent: boolean; count: number }> {
  if (transitions.length === 0) return { sent: false, count: 0 };
  const webhookUrl = opts.webhookUrl ?? process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return { sent: false, count: 0 };

  const doFetch = opts.fetchImpl ?? fetch;
  const text = ["*MCP 통합 상태 변경*", ...transitions.map(formatTransition)].join("\n");
  try {
    await doFetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return { sent: true, count: transitions.length };
  } catch {
    return { sent: false, count: transitions.length };
  }
}
