const MAIL_PREFIX = /^\s*(?:re|fw|fwd|rep|답장|전달|회신)\s*:\s*/i;
const LEADING_TAG = /^\s*\[([^\]]+)\]\s*/;
const MIN_REPEAT = 8;

// prod에 "A - BA - B C"처럼 같은 조각이 곧바로 다시 나오는 제목이 실재한다(스레드 병합 사고).
function collapseAdjacentRepeat(text: string): string {
  for (let len = Math.floor(text.length / 2); len >= MIN_REPEAT; len--) {
    for (let i = 0; i + len * 2 <= text.length; i++) {
      const first = text.slice(i, i + len);
      if (text.slice(i + len, i + len * 2) === first) {
        return (text.slice(0, i + len) + text.slice(i + len * 2)).replace(/\s{2,}/g, " ").trim();
      }
    }
  }
  return text;
}

export interface NormalizedDealTitle {
  title: string;
  tag: string | null;
}

/**
 * 메일 subject를 딜 제목으로 정규화한다.
 *
 * 선두 대괄호 태그는 파트너명(`[넥시아스]`)일 수도 발신 시스템 표식(`[SNET 구매포탈]`)일
 * 수도 있어 버리지 않고 `tag`로 돌려준다 — 파트너로 해석할지는 호출자가 정한다.
 */
export function normalizeDealTitle(raw: string): NormalizedDealTitle {
  let text = (raw ?? "").trim();

  // "Fwd: Re: …" 중첩이 실재하므로 더 벗겨지지 않을 때까지.
  let previous: string;
  do {
    previous = text;
    text = text.replace(MAIL_PREFIX, "");
  } while (text !== previous);

  text = text.replace(/\s{2,}/g, " ").trim();

  // 중복본은 여는 대괄호를 잃은 채 붙는다("[넥시아스] X넥시아스] X Y").
  // 대괄호를 잠시 떼고 접어야 두 조각이 인접해 보인다.
  text = text.startsWith("[")
    ? "[" + collapseAdjacentRepeat(text.slice(1))
    : collapseAdjacentRepeat(text);

  let tag: string | null = null;
  const tagMatch = text.match(LEADING_TAG);
  if (tagMatch) {
    tag = tagMatch[1].trim();
    text = text.slice(tagMatch[0].length);
  }

  // 제목이 접두어뿐이었다면 정규화가 통째로 비운다 — 그럴 땐 원문을 지킨다.
  if (!text) {
    return { title: raw.trim(), tag: null };
  }
  return { title: text, tag };
}

export function withTag({ title, tag }: NormalizedDealTitle): string {
  return tag ? `[${tag}] ${title}` : title;
}

const NEXT_ACTION_MAX = 60;

/**
 * 승인된 메일 후보에서 만드는 "다음 액션" 카피.
 *
 * 메일 요약 180자를 그대로 붙이던 탓에 딜 표의 셀이 메일 본문 덤프가 됐다.
 * 목록에서 한 줄로 읽히도록 한국어 카피 + 짧은 맥락만 남긴다.
 */
export function mailCandidateNextAction(summary: string): string {
  const context = (summary ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NEXT_ACTION_MAX);
  return context ? `승인된 메일 후보 검토 — ${context}` : "승인된 메일 후보 검토";
}
