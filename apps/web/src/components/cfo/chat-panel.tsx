"use client";

import { useState } from "react";

export function ChatPanel() {
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function send() {
    if (!message.trim()) return;
    setLoading(true);
    setReply(null);
    try {
      const res = await fetch("/api/finance/chatbot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      setReply(data.reply ?? JSON.stringify(data));
    } catch (e: unknown) {
      setReply(e instanceof Error ? e.message : "오류");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border bg-white p-4 space-y-3">
      <textarea
        className="w-full rounded border p-3 text-sm"
        rows={3}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="예: 이번 달 매출 얼마야?"
      />
      <button
        type="button"
        onClick={send}
        disabled={loading}
        className="rounded bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {loading ? "전송 중..." : "질문하기"}
      </button>
      {reply && (
        <div className="rounded bg-zinc-50 p-3 text-sm whitespace-pre-wrap">{reply}</div>
      )}
    </div>
  );
}
