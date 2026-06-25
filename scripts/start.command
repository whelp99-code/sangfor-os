#!/bin/bash
# AIOSv2 Integration 실행 스크립트
# 사용법: 이 스크립트를 더블클릭하거나 터미널에서 실행

PROJECT_DIR="${PROJECT_DIR:-/Users/jmpark/Playground/AIOSv2_integration}"
LOG_FILE="/tmp/aiosv2-server.log"

echo "🚀 AIOSv2 Integration 서버 시작 중..."
echo "📁 프로젝트 디렉토리: $PROJECT_DIR"
echo ""

# 포트 확인 및 해제
if lsof -ti :3110 > /dev/null 2>&1; then
    echo "⚠️  포트 3110이 사용 중입니다. 기존 프로세스를 종료합니다..."
    lsof -ti :3110 | xargs kill -9 2>/dev/null
    sleep 2
fi

# 프로젝트 디렉토리로 이동
cd "$PROJECT_DIR"

# 의존성 설치 확인
if [ ! -d "node_modules" ]; then
    echo "📦 의존성 설치 중..."
    pnpm install
fi

# 개발 서버 시작
echo "🔧 개발 서버 시작..."
echo "📡 서버 주소: http://localhost:3110"
echo ""
echo "접속할 페이지:"
echo "  - 홈: http://localhost:3110"
echo "  - 로그인: http://localhost:3110/auth/signin"
echo "  - 대시보드: http://localhost:3110/dashboard"
echo "  - 칸반: http://localhost:3110/kanban"
echo ""
echo "종료하려면 Ctrl+C를 누르세요."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 서버 시작
pnpm dev
