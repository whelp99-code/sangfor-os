#!/bin/bash
# AIOSv2 Integration 중지 스크립트

echo "🛑 AIOSv2 Integration 서버 중지 중..."

# 포트 3110 프로세스 종료 (AIOSv2 Web)
if lsof -ti :3110 > /dev/null 2>&1; then
    lsof -ti :3110 | xargs kill -9 2>/dev/null
    echo "✅ 포트 3110 프로세스 종료 완료"
else
    echo "ℹ️  포트 3110에 실행 중인 프로세스가 없습니다."
fi

# 포트 3300 프로세스 종료
if lsof -ti :3300 > /dev/null 2>&1; then
    lsof -ti :3300 | xargs kill -9 2>/dev/null
    echo "✅ 포트 3300 프로세스 종료 완료"
fi

echo ""
echo "🎉 모든 서버가 중지되었습니다."
echo ""
read -p "계속하려면 아무 키나 누르세요..."
