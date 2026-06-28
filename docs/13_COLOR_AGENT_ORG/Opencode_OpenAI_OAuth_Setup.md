# 도메인 AI LLM 백엔드 — opencode + OpenAI(ChatGPT) OAuth

> 도메인 AI 런타임(`domain-agent-runtime`)의 실제 LLM 호출을 **opencode 서버**로 보내고,
> OpenAI 인증은 **opencode 의 ChatGPT Plus/Pro 브라우저 OAuth** 로 처리한다(API 키 불필요).

## 왜 이 구조인가
- **OAuth 토큰 관리를 우리가 안 한다.** opencode 가 `auth.json` 에 토큰을 저장·갱신한다.
- opencode 서버 API 만 HTTP 로 호출 → 우리 코드는 `opencode-client.ts` 한 장.
- 모델은 "활성화 여부"가 아니라 **도메인별 적합성**으로 라우팅(`domain-llm.ts`).

## 1) opencode 설치 & OpenAI OAuth 로그인 (1회)
```bash
# 설치 (예시)
brew install sst/tap/opencode      # 또는: npm i -g opencode-ai

# OpenAI(ChatGPT) OAuth 로그인 — 브라우저에서 ChatGPT Plus/Pro 계정으로 인증
opencode auth login
#  → "OpenAI" 선택 → "ChatGPT Plus/Pro" (browser OAuth)
#  토큰 저장 위치: ~/.local/share/opencode/auth.json
```

## 2) opencode 서버 실행
```bash
opencode serve --port 4096 --hostname 127.0.0.1
#  헬스: curl http://127.0.0.1:4096/global/health
#  (선택) 비밀번호 보호: OPENCODE_SERVER_PASSWORD=... opencode serve
```

## 3) 환경변수 (apps/web/.env.local 또는 서비스 env)
```bash
OPENCODE_BASE_URL="http://127.0.0.1:4096"   # 기본값
OPENCODE_PROVIDER="openai"                   # 기본값
OPENCODE_MODEL="gpt-5"                        # /models 에서 보이는 modelID 로 교체
# OPENCODE_SERVER_PASSWORD="..."             # 서버를 password 보호한 경우만
# OPENCODE_SERVER_USER=""                     # basic-auth 사용자명 (기본 빈 문자열)
```
> 사용 가능한 정확한 `modelID` 는 opencode 에서 `/models` 로 확인.

## 4) 도메인 런타임에 연결
```ts
import { runDomainPipeline, createOpencodeDomainGenerator } from "@sangfor/business";

const generate = createOpencodeDomainGenerator({
  // 도메인별 모델 라우팅 (availability 아님 — 적합성 기준):
  models: {
    marketing: { providerID: "openai", modelID: "gpt-5-mini" }, // 대량·경량
    cfo:       { providerID: "openai", modelID: "gpt-5" },        // 강추론
    engineer:  { providerID: "openai", modelID: "gpt-5" },        // 강추론(민감)
  },
  // 미지정 도메인은 OPENCODE_MODEL 로 폴백
});

const results = await runDomainPipeline(
  { id: "mail-123", subject: "Sangfor 방화벽 견적", tags: ["firewall", "security"] },
  { generate },
);
```

## 호출 흐름
```
runDomainStage(domain)
  → buildDomainPrompt(recall 포함)
  → createOpencodeDomainGenerator → POST /session → POST /session/:id/message
        body: { model:{providerID,modelID}, parts:[{type:"text",text:prompt}] }
  → opencode → OpenAI(ChatGPT OAuth) → 응답 parts.text
  → DomainArtifact{ produces, summary=텍스트 }
  → 컬러 게이트 → 결정기록 → 학습
```

## 보안 메모
- opencode 서버는 기본 `127.0.0.1` 바인딩(로컬 전용). 원격 노출 시 `OPENCODE_SERVER_PASSWORD` 필수.
- OAuth 토큰은 opencode 의 `auth.json` 에만 존재(우리 DB/코드에 저장 안 함).
- 민감 데이터 도메인(engineer/cfo)은 승인된 모델로만 라우팅 — `AiModel.allowedDataClassification` 정책과 연계 권장(후속).

## 폴백/가용성 (후속)
가용성은 라우팅 키가 아니라 **폴백 체인**으로: `opencodeHealth()` 로 서버 확인 →
도메인 선호 모델 실패 시 기본 모델 → 그래도 실패면 stub. (현재는 단일 백엔드 + stub 폴백.)
