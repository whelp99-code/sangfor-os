"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SupportReplyDraft, SupportReplyRequest } from "@sangfor/business";
import { supportReplyPreviewSchema } from "./support-reply-preview";

const STATUS: Record<SupportReplyDraft["status"], string> = {
  draft: "원문 인용 초안 · 사람 검토 필요",
  needs_evidence: "추가 근거 필요",
  conflict: "근거 충돌 · 초안 보류",
  service_unavailable: "지식 서비스 연결 실패",
};

export function SupportReplyDraftResult({ draft }: { draft: SupportReplyDraft }) {
  return <section aria-live="polite" className="space-y-3" data-testid="support-reply-result">
    <strong>{STATUS[draft.status]}</strong>
    {draft.missingFacts.length > 0 && <ul>{draft.missingFacts.map(fact => <li key={fact}>{fact}</li>)}</ul>}
    {draft.draftText && <textarea aria-label="검토용 답장 초안" readOnly value={draft.draftText} rows={10} className="w-full rounded border p-2 text-sm" />}
    {draft.citations.map((citation, index) => <details key={`${citation.source}:${citation.chunkId}`}>
      <summary>[{index + 1}] {citation.title} · {citation.product} {citation.version ?? "버전 미확인"}</summary>
      <p className="whitespace-pre-wrap text-sm">{citation.quote}</p>
      <p className="break-all text-xs">청크 {citation.chunkId} · SHA-256 {citation.textSha256}</p>
      <a href={citation.source} target="_blank" rel="noopener noreferrer" className="underline">원문 확인</a>
    </details>)}
    <ul className="text-xs">{draft.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
  </section>;
}

/** A case-keyed editor: changing inputs invalidates any older in-flight preview. */
export function SupportReplyDraftPanel({ supportCaseId }: { supportCaseId: string }) {
  const [topic, setTopic] = useState<SupportReplyRequest["topic"]>("general");
  const [query, setQuery] = useState("");
  const [product, setProduct] = useState("");
  const [version, setVersion] = useState("");
  const [draft, setDraft] = useState<SupportReplyDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  function invalidate() {
    active.current?.abort();
    active.current = null;
    setBusy(false);
    setDraft(null);
    setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setDraft(null);
    setError(null);
    try {
      const response = await fetch(`/api/support/${encodeURIComponent(supportCaseId)}/reply-draft`, {
        method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ topic, query, product, ...(version.trim() ? { version: version.trim() } : {}) }),
      });
      const value = await response.json();
      if (active.current !== controller || controller.signal.aborted) return;
      // Only the server's typed preview shape is rendered; error responses are never draft text.
      const parsed = supportReplyPreviewSchema.safeParse(value);
      if ((!response.ok && response.status !== 502) || !parsed.success) {
        throw new Error("preview_unavailable");
      }
      setDraft(parsed.data);
    } catch {
      if (active.current === controller && !controller.signal.aborted) setError("초안을 불러오지 못했습니다. 접근 권한과 입력을 확인하고 다시 시도해 주세요.");
    } finally {
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }

  return <div className="pnl space-y-3" data-testid="support-reply-panel">
    <div className="ph"><b>출처 기반 답장 초안</b><span className="co mlbl">검토 전용</span></div>
    <p className="text-xs">고객명·장비 식별정보를 제외한 검색어를 입력하세요. 입력한 검색어만 지식 서비스에 전달하며 발송하거나 학습하지 않습니다.</p>
    <form onSubmit={submit} className="space-y-2">
      <label className="block text-sm">문의 유형
        <select value={topic} onChange={event => { invalidate(); setTopic(event.target.value as SupportReplyRequest["topic"]); }} className="block w-full rounded border p-2">
          <option value="general">일반 기술 문의</option><option value="renewal">갱신</option>
          <option value="service_letter">서비스레터</option><option value="kernel_patch">커널·패치</option>
        </select>
      </label>
      <label className="block text-sm">제품 코드
        <input value={product} onChange={event => { invalidate(); setProduct(event.target.value); }} required maxLength={100} placeholder="예: HCI" className="block w-full rounded border p-2" />
      </label>
      <label className="block text-sm">문서와 대조할 버전
        <input value={version} onChange={event => { invalidate(); setVersion(event.target.value); }} maxLength={100} placeholder="모르면 비워 두세요" className="block w-full rounded border p-2" />
      </label>
      <label className="block text-sm">검색할 질문
        <textarea value={query} onChange={event => { invalidate(); setQuery(event.target.value); }} required maxLength={2_000} rows={3} className="block w-full rounded border p-2" />
      </label>
      <button type="submit" disabled={busy || !query.trim() || !product.trim()} className="go disabled:opacity-50">{busy ? "근거 확인 중…" : "검토용 초안 만들기"}</button>
    </form>
    {error && <p role="alert" className="text-sm">{error}</p>}
    {draft && <SupportReplyDraftResult draft={draft} />}
  </div>;
}
