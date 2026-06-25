#!/bin/bash
# Mail data import script for AIOS v1

set -e

echo "📧 AIOS v1 메일 데이터 가져오기 시작..."

# 메일 가져오기
echo "1. 메일 메시지 가져오기 (1,000건)..."
curl -s -X POST http://localhost:3001/api/mail-import \
  -H "Content-Type: application/json" \
  -d '{"count": 1000}' | jq .

# 스레드 생성
echo "2. 메일 스레드 생성..."
curl -s -X POST http://localhost:3001/api/mail-insight-threads/generate \
  -H "Content-Type: application/json" \
  -d '{"limit": 1000}' | jq .

# 후보 생성
echo "3. 메일 후보 생성..."
curl -s -X POST http://localhost:3001/api/mail-candidates \
  -H "Content-Type: application/json" \
  -d '{"limit": 1000}' | jq .

echo "✅ 메일 데이터 가져오기 완료!"
