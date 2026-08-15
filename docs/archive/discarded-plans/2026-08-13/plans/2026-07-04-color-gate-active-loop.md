# 컬러게이트 능동 루프 — 접지 + AI 재작업 + 정직한 에스컬레이션 구현 계획

> **목적**: 컬러렌즈가 "판정만 하고 아무 일도 안 하는 장식"에서 → **실제로 문서를 통과/개선/반려시키는 능동 게이트**로 "확실히 동작"하게 만든다.
> **원인(확인됨)**: ①생성 컨텍스트가 얇음(255자 preview 1건) ②게이트 fail이 아무것도 트리거 안 함(AI 재작업 루프 부재, fail이어도 자동승격).
> **해법 3축**: 접지(스레드 집약 + 라이트 KB RAG) + AI 재작업 루프(self-refine) + 정직한 에스컬레이션(통과분만 승격, 나머지 사람에게).

## 전역 제약
- 환각 금지: 재작업 시 컨텍스트에 없는 수치·사실을 지어내지 말고 "확인 필요"로. (게이트 gaming 방지 — 정직성 핵심)
- LLM 9router 강제(제로비용). DB 쓰기 전 스냅샷.

## 파일 변경
- Create: `packages/business/src/domain-ai/proposal-context.ts` — 접지 컨텍스트 빌더.
- Modify: `packages/business/src/domain-ai/domain-proposal.ts` — 재작업 루프 + attempts/escalated.
- Modify: `packages/business/scripts/replay-generate-documents.ts` — 접지 컨텍스트 사용 + 정직한 에스컬레이션(통과분만 승인).

---

## Task 1: 접지 컨텍스트 빌더 (grounding 1+2)

**File**: `proposal-context.ts`
```ts
import { prisma } from '@sangfor/db';

const SANGFOR_KB_TERMS = ['Sangfor', 'HCI', 'NGAF', 'VM', 'aStor', '보안', 'security'];

export interface GroundedContextInput {
  match: string;          // 관련 메일 검색어(고객명/도메인 조각)
  customerName: string;
  baseNote?: string;      // 기존 단일 메일 컨텍스트(있으면 앞에 붙임)
  maxMails?: number;      // 기본 20
}

/** 스레드 집약(전 고객 메일 시간순) + 라이트 KB RAG(키워드 청크). */
export async function buildGroundedContext(input: GroundedContextInput): Promise<string> {
  const mails = await prisma.mailMessage.findMany({
    where: { OR: [{ subject: { contains: input.match } }, { fromEmail: { contains: input.match } }] },
    orderBy: { receivedAt: 'asc' },
    take: input.maxMails ?? 20,
    select: { receivedAt: true, direction: true, subject: true, bodyPreview: true },
  });
  const timeline = mails
    .map((m) => `- [${m.receivedAt?.toISOString().slice(0, 10) ?? ''}] ${m.direction === 'outbound' ? '우리→' : '←상대'} ${m.subject ?? ''}: ${(m.bodyPreview ?? '').slice(0, 120)}`)
    .join('\n');

  // KB 키워드: 메일 제목에서 제품 용어 추출 + 기본 Sangfor 용어
  const subjectsBlob = mails.map((m) => m.subject ?? '').join(' ');
  const kw = SANGFOR_KB_TERMS.filter((t) => subjectsBlob.includes(t) || t === 'Sangfor');
  const chunks = kw.length
    ? await prisma.knowledgeChunk.findMany({
        where: { OR: kw.map((k) => ({ content: { contains: k } })) },
        take: 5,
        select: { content: true },
      })
    : [];
  const kb = chunks.map((c) => `- ${c.content.slice(0, 220)}`).join('\n');

  const base = input.baseNote ? `${input.baseNote}\n\n` : '';
  return `${base}## 이 딜의 메일 타임라인(${mails.length}건, 시간순)\n${timeline || '- (관련 메일 없음)'}\n\n## 제품/레퍼런스 지식(KB)\n${kb || '- (매칭 지식 없음)'}`;
}
```
- Steps: 작성 → `npx tsc -p packages/business/tsconfig.json --noEmit` 통과.

## Task 2: AI 재작업 루프 (self-refine)

**File**: `domain-proposal.ts`
- `DomainProposal`에 `attempts?: number; escalated?: boolean` 추가.
- 생성+게이트를 함수 내부 헬퍼로 묶고, 초기 생성 후 `gate.pass`가 아니면 **재작업 프롬프트**로 재생성→재게이트 반복(최대 `PROPOSAL_MAX_REVISIONS`, 기본 2).
- 재작업 프롬프트(system 재사용, user 교체):
```
아래 제안서가 컬러게이트 5렌즈 검증에서 다음 지적을 받았습니다:
<failing lenses + note 목록>
같은 섹션 템플릿과 헤딩 규칙을 유지하되, 각 지적을 아래 컨텍스트의 실제 근거로 보완해 다시 작성하세요.
컨텍스트에 없는 수치·사실은 지어내지 말고 "확인 필요"로 남기세요.
[컨텍스트 재첨부]
[현재 제안서 본문]
json {title, bodyMarkdown} 로만 반환.
```
- 최종 `colorGate`, `attempts`, `escalated = colorGate && !colorGate.pass` 를 record(colorGateJson에 attempts/escalated 포함) + return.

## Task 3: 정직한 에스컬레이션 (runner)

**File**: `replay-generate-documents.ts`
- contextNote = `await buildGroundedContext({ match: deal.match, customerName: deal.name, baseNote: <기존 단일 메일 컨텍스트> })`.
- 생성 후: **`proposal.colorGate?.pass === true`일 때만 `recordHumanDecision('approved')` 로 승격.** 아니면 승격하지 않고(=pending, 사람 검토 큐) escalated로 로그.
- 리포트에 `attempts`, `escalated`, `colorGatePass` 기록.

## Task 4: 검증 (리플레이 재실행)

- 스냅샷 → `npx tsx ...replay-generate-documents.ts --apply` 재실행.
- 확인: ①게이트 **pass 문서가 생김**(또는 정직하게 escalated로 남음) ②형태 일관 유지(9섹션 #) ③attempts>1인 문서에서 실제 내용이 깊어졌나(렌즈 fail이 줄었나) ④환각 없이 "확인 필요"로 남겼나(정직성).
- 전후 비교(v2 개요수준 vs v3 접지+재작업) 리포트.

## Definition of Done
- 재실행 결과에서 최소 일부 제안서가 게이트 통과, 통과 못한 건은 자동승격 안 되고 escalated. 형태 일관 유지. 환각 없음(근거 없는 값은 "확인 필요").
