# 디자인·i18n 하드닝 패스 — 설계/결정문서

**작성:** 2026-07-13 (실사용 QA R6~R11, agy 전수 인벤토리 기반) · **상태:** 설계 검토 대기(구현 전, 디자인 민감 — 목업 확인 후 착수)
**인벤토리 정본:** `.agents/coop/design-i18n-map.md` (agy, 라우트·요소·현재값·권장 라벨·헬퍼·P0/P1/P2 전수)

## 0. 한 줄 요약
기능/정합은 수렴됐고, 남은 사용자 체감 결함은 **① raw enum/내부키가 화면에 코드로 노출**(딜 stage·프로젝트 status·파트너 시드키·다음액션 메일덤프), **② 좁은 폭 반응형 붕괴**(딜 표 4753px 등), **③ 잔여 영문 크롬**이다. 대부분 **기존 라벨 헬퍼 재적용**으로 저위험 해소 가능하나, 디자인 민감 영역이라 **목업 확인 후 착수** 권장.

## 1. 먼저 정할 결정 (디자인)
1. **LOST 라벨 통일** — `STAGE_LABELS.LOST="실패"` vs `STATUS_LABELS.LOST="실주"` **불일치**(agy 발견). GTM 용어 정합 위해 하나로: **"실주" 권장**(영업 관행) 또는 "실패". → 단일 소스 결정 후 양쪽 정렬.
2. **모바일 표 전략** — 딜/고객/파트너 표의 좁은 폭 대응: (a) 우선 열만 + 가로 스크롤 컨테이너(저공수) vs (b) 모바일 카드형 리플로우(고공수·고완성도). 디자인 민감 → 목업 필요.
3. **브랜드 크롬 정책** — `SANGFOR Partner OS`·`Control Tower`를 한국어화할지(관제 타워) 브랜드 영문 유지할지. `AI AUTOMATION WORK PORTAL`·`Demo Project`·`Portal Operator`는 한국어화 권장.

## 2. 구현 웨이브 (agy §4 기반, AC 부가)
> 원칙: **기존 헬퍼(`stageLabel`/`displayStatus`/신규 라벨맵) 재적용**으로 단일 소스화. enum 코드는 절대 화면 직노출 금지.

### W-i18n-A · P0 딜 경로 enum (최고 체감)
- 딜 헤더/활동 타임라인/Phase13 패널의 stage를 `stageLabel()` 적용(PROPOSAL→제안, WON→수주, QUALIFIED→검증…). 활동 노트 `Stage advanced`/`Opportunity created`용 `ACTIVITY_NOTE_LABELS` 신설.
- **AC**: 딜 목록·상세·활동에서 raw stage/note 코드 0.

### W-i18n-B · P0 다음액션 + 딜 표 반응형 (묶음)
- `/deals` 표「다음 액션」셀 `Review approved mail candidate:` + 메일 전문 덤프(29건) → 서버 카피 정규화 + 1줄 clamp. 이게 딜 표 4753px 폭의 주원인이라 **반응형 P0와 동시 해소**.
- **AC**: 다음액션 1줄, 딜 표 데스크톱 폭 정상·좁은 폭 가로스크롤/카드.

### W-i18n-C · P1 마스터·크롬
- 프로젝트 status(pre_engagement→사전 접촉 등) `PROJECT_STATUS_LABELS`, 파트너 kind(`mail-derived`→표시전환)·시드키(`ground-truth-*` 숨김), `Economic Buyer` 괄호 제거, 보안 위험키 `RISK_ACTION_LABELS`, customers `active`→활성(`displayStatus` 미적용 구간), 전역 크롬 5문자열.
- **AC**: P1 표면 raw 코드·영문 크롬 0(결정된 브랜드 예외 제외).

### W-resp · 반응형 붕괴
- `/agents` 고정폭 제거(그리드 wrap), `/deals/registrations` 보드 가로스크롤 명시, `/contacts`·`/partners`·`/home` 표 좁은 폭 대응(결정1-(2) 전략).
- **AC**: 375/768px 주요 라우트 가로스크롤 없음(또는 의도된 스크롤 UX). `/finance`가 양호 레퍼런스.

## 3. 범위/주의
- **디자인 민감 사용자** → W-resp·크롬은 목업/스크린샷 확인 후. i18n(A/C)은 문자열 스왑이라 저위험이나 라벨은 헬퍼 단일 소스로.
- 도메인 약어(PoC·BANT·SOW) 유지 + 첫 노출 툴팁. 시드 고유명(`VDI-Korean-POC`) 번역 금지.

## 4. 근거
- 전수 인벤토리·권장 라벨·반응형 수치: `.agents/coop/design-i18n-map.md`
- 교차 정합: `ux-round-9-agy.md`·`ux-round-10-agy.md`
