# DESIGN.md — BLRO OS · "계기판(Instrument)"

> 관제탑 디자인 시스템. 방향 A(계기판) 확정, 2026-07-04. 근거: `.design-context.md`.
> 로컬 신세시스(vendor seed 미사용). 구현: oma-frontend가 이 문서를 단일 소스로 사용.

---

## 1. 디자인 원칙 (Direction)

BLRO OS는 **AI-native 회사 운영 CRM**이다. 관제탑은 제품 범주가 아니라 대표 1인이 역할 AI 5 + 컬러 AI 5 편대를 감독하는 UX 원칙이며, 화면은 *읽는 계기*여야 한다.

1. **계기는 정직하다.** 모든 수치는 실측 근거를 가진다. 0과 빈 표는 "측정된 0"과 "미수집"을 구분해 표기.
2. **2재질.** 어두운 계기 하우징(내비/헤더)이 밝은 판독 패널(콘텐츠)을 감싼다. 기기의 베젤과 스크린.
3. **누가 말하는지 형태로 구분.** 사람 문장=Pretendard, 기계/계기(라벨·금액·D-day·로그)=IBM Plex Mono.
4. **5색은 AI 검증 전용, 브라스는 사람 전용.** 색만 봐도 "AI가 한 것 vs 내가 결정할 것"이 읽힌다.
5. **대담함은 한 곳에.** 시그니처(5색 검증 콘솔)에만 색과 디테일을 몰고 나머지는 조용히.
6. **모바일이 기본.** 375px에서 승인 큐+임박 요약이 동작, 위로 향상.

**미학적 모험(단 하나):** 제품의 검증 시스템(5색 AI)을 인터페이스 정체성으로 삼아 *계기(EQ 게이지)*로 문자 그대로 구현한다. Braun/Teenage Engineering의 절제된 정밀.

---

## 2. 색상 시스템 (Color)

세미틱 이름 + hex. **원칙: 5색 채널·브라스는 채움/선/액센트에 사용, 텍스트로 쓸 땐 `-deep` 변형으로 AA 확보.**

### 중립 (2재질)
| 토큰 | Hex | 용도 |
|---|---|---|
| Aluminium Base (`--paper`) | `#E7E6E0` | 앱 캔버스 (따뜻한 알루미늄) |
| Readout Panel (`--panel`) | `#F8F7F3` | 판독 패널/카드 |
| Inset (`--panel-2`) | `#F2F0EA` | 초안 인셋·트랙 배경 |
| Housing (`--frame`) | `#191B1E` | 계기 하우징 (내비·프레임) |
| Housing Raised (`--frame-2`) | `#232529` | 하우징 활성/호버 |
| Ink (`--ink`) | `#191A17` | 본문 텍스트 (15.5:1 on panel · AAA) |
| Muted (`--muted`) | `#605E55` | 보조 텍스트 (5.7:1 · AA ✓) |
| Faint (`--faint`) | `#8C897E` | 장식/대형 라벨만 (본문 텍스트 금지) |
| Line (`--line`) | `#D4D2C9` | 헤어라인 |
| Line Soft (`--line-2`) | `#E5E3DB` | 내부 구분선 |
| Frame Ink (`--frame-ink`) | `#C7C6BE` | 하우징 위 텍스트 |
| Frame Faint (`--frame-faint`) | `#7C7E80` | 하우징 위 보조 |

### 5색 검증 채널 (AI 검증 전용 — 장식 금지)
| 채널 | Fill | Text(`-deep`) | 의미 |
|---|---|---|---|
| Blue | `#2C5FE0` | `#1E44A8` | 기술 |
| Red | `#D2373C` | `#B02226` | 리스크 |
| Orange | `#DE7716` | `#A9530A` | 비즈니스 가치·마진 |
| Gray(warm) | `#848177` | `#5E5C53` | 문서·근거 |
| Teal | `#0E9784` | `#0A6B5E` | UX·고객 전달 명료성 |

### 지휘관 브라스 (사람의 결정 전용)
| 토큰 | Hex | 용도 |
|---|---|---|
| Brass (`--commander`) | `#A9822E` | 승인 밑줄·로고 마크·인디케이터 (비텍스트) |
| Brass Deep (`--commander-ink`) | `#7C5E1E` | 브라스 텍스트/라벨 (AA) |
| Brass BG (`--brass-bg`) | `#F5EEDD` | 사람 액션 배경(확인 버튼) |
| Brass Line (`--brass-line`) | `#E4D6B4` | 사람 액션 테두리 |

### 상태
- pass = 해당 채널색 풀 · wait = 채널색 32% 불투명 · flag = 풀 + Red 링(`box-shadow`).
- 금지: 보라→파랑 그라디언트, 그라디언트 오브, 글래스+블러, 메시 그라디언트, 순백on순흑.
- 허용: 미세 그레인 텍스처(feTurbulence, opacity ≤ .03, multiply), 동일 계열 미세 그라디언트(패널 헤더 정도).

---

## 3. 타이포그래피 (Typography)

한국어 1순위 → **Pretendard Variable** 본문. 표시용 IBM Plex Sans KR, 계기용 IBM Plex Mono.

```
--font-sans: "Pretendard Variable", Pretendard, -apple-system, system-ui, sans-serif;
--font-disp: "IBM Plex Sans KR", "Pretendard Variable", sans-serif;
--font-mono: "IBM Plex Mono", ui-monospace, "SFMono-Regular", monospace;
```

| 역할 | 폰트 | 크기(px) | 자간/굵기/행간 |
|---|---|---|---|
| Display (화면 제목) | disp | 25 | -.025em / 700 / 1.0 |
| Section head (h2) | disp | 14.5 | -.01em / 600 |
| Slip title | disp | 15 | -.015em / 600 |
| Body prose | sans | 14.5 | 600↓ / 1.72 (CJK) |
| Meta / data | mono | 11–12 | .01em / 500 / tnum |
| Micro-label | mono | 10 | .16em / 500 / UPPERCASE |
| Numeric(금액/D-day) | mono | 15 | -.01em / 600 / tnum |

- **CJK 행간 1.7–1.8**(prose), 숫자는 `font-feature-settings:"tnum" 1,"zero" 1`.
- **모바일 본문 ≥ 16px.** 데스크톱 14.5px 허용(고밀도 계기), 모바일에서 16px로 승격.
- 폰트 3종은 프로젝트 정체성(사람/표시/기계 구분)으로 정당화됨 — 슬롭 아님.

---

## 4. 공간 & 레이아웃 (Spacing / Layout)

- **4px 리듬 · 8px 그리드.** 라운드: 패널 12 · 배지 8 · 칩/버튼 7–8 · 트랙 3.
- **레이아웃**: 좌 하우징 레일(240) + 판독 메인(≤1180) + 우 계기 레일(314).
- **브레이크포인트**: 375 · 768 · 1024 · 1280 · 1600.
  - `<1024`: 좌 레일 → 아이콘(64) 또는 드로어; 메인/우레일 세로 스택.
  - `<768`(모바일): 레일 → 하단 탭 or 햄버거; 화면은 **승인 큐 + 임박 요약**만; 슬립은 콘솔 축약(채널만).
- 중첩 카드 안 중첩 카드 금지. 슬립 내부는 인셋(1레벨)까지만.

---

## 5. 모션 (Motion)

- 마이크로 150ms · 트랜지션 200–500ms(상한) · 페이지 로드 스태거 ≤ .5s · EQ 채널 채움 .55s.
- **transform + opacity만**(60fps). 바운스 이징 금지. 800ms↑ 금지.
- 시그니처 모먼트 1개: 로드 시 슬립이 살짝 떠오르고 5색 콘솔이 아래→위로 채워짐(실시간 검증 은유). 그 외 조용히.
- `@media (prefers-reduced-motion: reduce)` → 모든 애니메이션 제거(즉시 표시).

---

## 6. 컴포넌트 (Components)

**베이스**: shadcn/ui (이미 설치됨 · `apps/web/src/components/ui`).
```
# 필요 시 추가
npx shadcn@latest add card button badge dialog dropdown-menu tabs tooltip scroll-area
```

**커스텀 시그니처(신규 제작)**:
| 컴포넌트 | 역할 |
|---|---|
| `VerificationConsole` | 5채널 EQ 게이지(B·R·O·G·T, 눈금 트랙, pass/wait/flag) + verdict 판독. **시그니처.** |
| `DispatchSlip` | 승인 전표: 헤더(역할AI 배지·제목·워크플로 태그·고객·금액) / AI초안 인셋 / 콘솔 / 결정. |
| `RoleAIBadge` | 역할 AI 36px 정사각 배지(MK/SA/PS/EN/CF), 도메인색 그라디언트. |
| `TimeRuler` | 임박(시간 트리거) 세로 D-day 계기 — 눈금선 + 틱 + 이벤트. |
| `BriefBanner` | AI 야간 브리핑(텔렉스 헤더 + 문장 + 모노 칩). |
| `InboxTriageRow` | 인입 원탭 분류(소스 태그 + AI 추정 하이라이트 + 확인 버튼). |
| `AutonomyDial` | 역할 AI 자율도(관찰→초안→자동→위임) + 승급 넛지. (AI팀 화면) |
| `CommanderButton` | 사람 결정 버튼(잉크 배경 + 브라스 밑줄). |

**포커스**: 모든 인터랙티브 요소 `:focus-visible` 2px 브라스 아웃라인 + 2px 오프셋. 호버 전용 금지(키보드/터치 대체 필수).

---

## 7. 시그니처 (Signature)

**5색 검증 콘솔** — 컬러 AI 5종을 EQ 미터로. 각 채널: 눈금 트랙 + 채움 레벨(pass 상단/mid 중단/wait 하단·희미) + 채널 문자(B R O G T). Red 보류는 트랙에 링. 이 모티프가 모든 산출물에 반복 등장해 앱의 심장이 된다. (렌더 검증 완료: `/tmp/blro-cockpit/v2.png`)

---

## 8. 접근성 (Accessibility · WCAG 2.2 AA)

- 본문/보조 텍스트 대비 AA 충족(ink 15.5:1, muted 5.7:1 on panel). 채널색은 **텍스트로 쓸 때 `-deep`** 변형.
- 색만으로 상태 전달 금지 — 콘솔은 색 + **채널 문자 + 채움 레벨 + verdict 문장** 병행.
- `:focus-visible` 가시 포커스, 키보드 전체 탐색, 터치 타깃 ≥ 44px(모바일).
- `prefers-reduced-motion` 존중, `prefers-color-scheme` 다크 대응은 v2(관측소 스킨)로 후속.
- 이미지/아이콘 대체텍스트, 상태 변화는 `aria-live`(브리핑·승인 결과).

---

## 9. 안티패턴 (이 프로젝트 특별 금지)

- 보라→파랑 그라디언트 · 그라디언트 오브/블롭 · 글래스모피즘+블러 · 메시 그라디언트 히어로.
- 크림+세리프+테라코타 / 니어블랙+애시드 / 신문 헤어라인 (AI 흔한 3패턴).
- 동일한 3-지표 히어로, 중첩 카드, 데스크톱 고정폭, 순백on순흑.
- 800ms↑·전역 바운스, 모바일 16px 미만 본문.
- 5색을 **장식**으로 남발(검증 외 사용 금지), 브라스를 AI 요소에 사용.

---

## 토큰 익스포트 (CSS 변수 — oma-frontend 구현용)

```css
:root{
  --paper:#E7E6E0; --panel:#F8F7F3; --panel-2:#F2F0EA;
  --frame:#191B1E; --frame-2:#232529; --frame-ink:#C7C6BE; --frame-faint:#7C7E80;
  --ink:#191A17; --muted:#605E55; --faint:#8C897E; --line:#D4D2C9; --line-2:#E5E3DB;
  --blue:#2C5FE0; --blue-deep:#1E44A8; --red:#D2373C; --red-deep:#B02226;
  --orange:#DE7716; --orange-deep:#A9530A; --gray:#848177; --gray-deep:#5E5C53;
  --teal:#0E9784; --teal-deep:#0A6B5E;
  --commander:#A9822E; --commander-ink:#7C5E1E; --brass-bg:#F5EEDD; --brass-line:#E4D6B4;
  --font-sans:"Pretendard Variable",Pretendard,-apple-system,system-ui,sans-serif;
  --font-disp:"IBM Plex Sans KR","Pretendard Variable",sans-serif;
  --font-mono:"IBM Plex Mono",ui-monospace,monospace;
  --r-panel:12px; --r-ctl:8px; --grid:8px;
  --ease:cubic-bezier(.2,.7,.3,1);
}
```

```js
// tailwind.config — theme.extend (발췌)
colors:{ paper:'#E7E6E0', panel:'#F8F7F3', frame:'#191B1E', ink:'#191A17', muted:'#605E55',
  ch:{ blue:'#2C5FE0', red:'#D2373C', orange:'#DE7716', gray:'#848177', teal:'#0E9784' },
  commander:'#A9822E' },
fontFamily:{ sans:['Pretendard Variable','Pretendard','system-ui'], disp:['IBM Plex Sans KR'], mono:['IBM Plex Mono'] },
borderRadius:{ panel:'12px' }
```

---
*로컬 신세시스로 작성 — vendor seed 미사용, MIT 귀속 대상 없음.*
