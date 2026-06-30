/**
 * Per display-stage content for the "이 단계 가이드" panel.
 * Keyed by STAGE_DISPLAY idx (1–6); see stage-meta.ts for the enum→idx mapping.
 */
export interface StageGuideEntry {
  tag: string;
  exit: string;
  deliverables: string[];
  ai: string[];
}

export const STAGE_GUIDE: Record<number, StageGuideEntry> = {
  1: {
    tag: "① 제안",
    exit: "딜등록 승인 + 경제적 의사결정자 식별 + 제안서 확인 + 평가기준 합의",
    deliverables: [
      "Deal Registration 등록(총판 대행)",
      "BANT 자격검증",
      "제안서(솔루션+가격)",
      "평가기준·일정 합의",
    ],
    ai: ["제안서 초안 만들기", "총판 제출용 딜등록 정보 정리"],
  },
  2: {
    tag: "② PoC",
    exit: "합의 성공기준에 크로스펑셔널 사인오프",
    deliverables: [
      "평가계획서(use case↔비즈니스)",
      "측정가능 성공기준",
      "Mutual Action Plan(30~90일)",
      "이해관계자 매핑",
    ],
    ai: ["평가계획 템플릿 불러오기", "성공기준 측정식 제안"],
  },
  3: {
    tag: "③ 결과제출",
    exit: "합의 성공기준 충족 입증 + 고객 기술·비즈니스 검증 인정",
    deliverables: [
      "성공기준 대비 정량 결과 보고",
      "비즈니스 가치/ROI(POV)",
      "경영진 readout 일정",
      "사후 인수인계 계획",
    ],
    ai: ["측정값으로 ROI 표 초안", "유사 사례 ROI 찾기"],
  },
  4: {
    tag: "④ 선정·입찰",
    exit: "고객 벤더 선정 + 법무·구매 경로 확인 + 가격 합의",
    deliverables: [
      "RFP/입찰 응답",
      "특별가(SPR) 요청(총판 경유)",
      "경쟁 포지셔닝",
      "Paper Process 확인",
    ],
    ai: ["RFP 항목 응답 초안", "총판 제출용 SPR 요청서"],
  },
  5: {
    tag: "⑤ 수주",
    exit: "SOW 서명 + 발주(PO) 수령 + 딜리버리팀 인수",
    deliverables: [
      "SOW/계약 체결",
      "마일스톤 결제 구조",
      "영업→딜리버리 핸드오프",
    ],
    ai: ["SOW 초안 점검", "마일스톤·결제 일정 생성"],
  },
  6: {
    tag: "⑥ 딜리버리",
    exit: "단계별 Phase Sign-off + 이슈 baseline 복귀 + 지식 이관",
    deliverables: [
      "킥오프→설계(FRD)→구축·통합",
      "UAT(고객 주도·사인오프)",
      "Go-Live(Go/No-Go)",
      "핸드오버·하이퍼케어",
    ],
    ai: ["UAT 시나리오 생성", "핸드오버 문서 초안"],
  },
};
