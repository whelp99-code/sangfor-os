const LEADING_TAG = /^\s*\[([^\]]+)\]\s*/;

export function splitDealTitle(title: string): { tag: string | null; text: string } {
  const match = title.match(LEADING_TAG);
  if (!match) return { tag: null, text: title };
  const text = title.slice(match[0].length).trim();
  // 태그만 있고 본문이 없으면 쪼개지 않는다 — 칩만 남고 제목이 사라진다.
  if (!text) return { tag: null, text: title };
  return { tag: match[1].trim(), text };
}

export function DealTitle({ title, className }: { title: string; className?: string }) {
  const { tag, text } = splitDealTitle(title);
  return (
    <p className={className}>
      {tag ? (
        <span className="mr-1.5 inline-flex items-center rounded border border-amber-200/70 bg-amber-50 px-1.5 py-px align-[1px] text-[10px] font-semibold text-amber-800">
          {tag}
        </span>
      ) : null}
      {text}
    </p>
  );
}
