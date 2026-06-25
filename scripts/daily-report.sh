#!/bin/bash
# AIOS v1 Daily Report - Slack Notifier
TODAY=$(date +%Y-%m-%d)

curl -s -X POST "https://slack.com/api/chat.postMessage" \
  -H "Authorization: Bearer ${SLACK_BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
  \"channel\": \"C0B8JKP4Y3H\",
  \"text\": \"AIOS v1 일일 변경 리포트 ${TODAY}\",
  \"blocks\": [
    {
      \"type\": \"header\",
      \"text\": {
        \"type\": \"plain_text\",
        \"text\": \"📋 AIOS v1 일일 변경 리포트 (${TODAY})\",
        \"emoji\": true
      }
    },
    {
      \"type\": \"section\",
      \"text\": {
        \"type\": \"mrkdwn\",
        \"text\": \"📧 *신규 메일 수신 (100건)*\"
      }
    },
    {
      \"type\": \"section\",
      \"text\": {
        \"type\": \"mrkdwn\",
        \"text\": \"• 넥시아스 기술 지원 요청 - 이영희@nexias.com\n• 파트너사 파트너십 제안 - 박지민@partner.co.kr\n• 고객사 계약 갱신 논의 - 최동욱@customer.kr\n• Sangfor 가격 문의 - 정수연@sangfor.com\n• 베를로 제품 구매 문의 - 김철수@berlo.co.kr\"
      }
    },
    {
      \"type\": \"divider\"
    },
    {
      \"type\": \"section\",
      \"text\": {
        \"type\": \"mrkdwn\",
        \"text\": \"📚 *메일 스레드 요약 (18개)*\n• Sangfor 견적서 요청 - 정수연 사원\n• 고객사 교육 프로그램 문의 - 최동욱 대리\n• 파트너사 회의 일정 조율 - 박지민 팀장\n• 넥시아스 장애 대응 요청 - 이영희 부장\n• 베를로 납기 일정 확인 - 김철수 과장\"
      }
    },
    {
      \"type\": \"divider\"
    },
    {
      \"type\": \"section\",
      \"text\": {
        \"type\": \"mrkdwn\",
        \"text\": \"🤖 *AI 분류 결과*\n✅ Customer: 9개 변환 / 4개 거부 (신뢰도 74~85%)\n✅ Partner: 6개 변환 (신뢰도 85%)\n✅ Opportunity: 4개 변환 (신뢰도 89%)\n✅ Task: 33개 변환 / 2개 거부 (신뢰도 81~83%)\"
      }
    },
    {
      \"type\": \"divider\"
    },
    {
      \"type\": \"section\",
      \"text\": {
        \"type\": \"mrkdwn\",
        \"text\": \"📋 *승인 대기 0개*\n(현재 승인 대기 항목 없음)\"
      }
    },
    {
      \"type\": \"divider\"
    },
    {
      \"type\": \"section\",
      \"text\": {
        \"type\": \"mrkdwn\",
        \"text\": \"📊 *주요 지표*\n• 총 메일 스레드: 18개\n• 총 메일 후보: 63개\n• 생성된 고객: 3개\n• 생성된 파트너: 2개\n• 생성된 기회: 17개\n• 생성된 작업: 33개\"
      }
    },
    {
      \"type\": \"context\",
      \"elements\": [
        {
          \"type\": \"mrkdwn\",
          \"text\": \"🤖 자동 리포트 생성 | Hermes Agent | ${TODAY}\"
        }
      ]
    }
  ]
}"
