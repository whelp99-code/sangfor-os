/**
 * Shared client for POST /api/agent/run (SSE stream).
 *
 * Use this from any workbench page's onCommand handler instead of duplicating
 * the fetch + SSE-parse logic.  Returns an honest status string suitable for
 * the AICommandBar toast — never throws.
 *
 * Usage (in a page.tsx):
 *   import { runAgentCommand } from "@/components/ai-workspace"
 *   onCommand={(cmd) => runAgentCommand(cmd, "<role-name>")}
 */

interface SseFrame {
  event: string
  data: string
}

/**
 * Parse a single SSE frame (event: <name>\ndata: <json>\n\n).
 * Returns null if the frame is empty or unparseable.
 */
function parseSseFrame(block: string): SseFrame | null {
  const lines = block.trim().split("\n")
  let event = ""
  let data = ""
  for (const line of lines) {
    if (line.startsWith("event: ")) {
      event = line.slice(7).trim()
    } else if (line.startsWith("data: ")) {
      data = line.slice(6).trim()
    }
  }
  if (!event && !data) return null
  return { event, data }
}

/**
 * Post a goal to /api/agent/run, consume the SSE stream, and return an honest
 * status message in Korean suitable for the AICommandBar toast.
 *
 * @param goal  The user's command text (non-empty).
 * @param source  Role name sent as JSON body `source` (e.g. "executive", "sales").
 * @returns  A status string — never throws, never rejects.
 */
export async function runAgentCommand(goal: string, source: string): Promise<string> {
  let response: Response
  try {
    response = await fetch("/api/agent/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal, source }),
    })
  } catch {
    return "실행 실패: 네트워크 오류"
  }

  if (!response.ok) {
    return `실행 실패: 서버 응답 오류 (${response.status})`
  }

  if (!response.body) {
    return "실행 실패: 서버 응답 오류 (스트림 없음)"
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
    }
  } catch {
    return "실행 실패: 스트림 읽기 오류"
  }

  // Parse all complete SSE frames from the accumulated buffer
  const frames = buffer.split("\n\n")

  // Find the terminal event (last `error` or `done` wins)
  let terminalEvent: SseFrame | null = null
  for (const block of frames) {
    const frame = parseSseFrame(block)
    if (!frame) continue
    if (frame.event === "error" || frame.event === "done") {
      terminalEvent = frame
    }
  }

  if (!terminalEvent) {
    return "실행 실패: 서버가 응답을 완료하지 못했습니다"
  }

  if (terminalEvent.event === "error") {
    try {
      const data = JSON.parse(terminalEvent.data)
      return `실행 실패: ${data.message ?? "알 수 없는 오류"}`
    } catch {
      return "실행 실패: 알 수 없는 오류"
    }
  }

  // terminalEvent.event === "done"
  try {
    const data = JSON.parse(terminalEvent.data)
    const status: string = data.status ?? ""
    const answer: string | undefined = data.answer
    const blockedTool: string | undefined = data.blockedTool

    if (answer && typeof answer === "string" && answer.trim().length > 0) {
      return answer
    }

    switch (status) {
      case "blocked":
        return blockedTool
          ? `승인 필요: ${blockedTool} 실행이 대기 중입니다`
          : "승인이 필요합니다"
      case "max_steps":
        return "최대 단계에 도달했습니다 (응답 없음)"
      case "error":
        return "실행 실패: 에이전트가 응답을 생성하지 못했습니다"
      default:
        return "실행 실패: 에이전트가 응답을 생성하지 못했습니다"
    }
  } catch {
    return "실행 실패: 응답을 처리할 수 없습니다"
  }
}
