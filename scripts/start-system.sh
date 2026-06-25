#!/bin/bash
# AIOS v2 전체 시스템 기동 스크립트
# 
# Docker Compose로 PostgreSQL + Redis + API + Web을 한 번에 기동하고
# 헬스체크를 수행합니다.

set -e

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 로그 함수
log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 환경 변수 확인
check_env() {
    log_info "환경 변수 확인 중..."
    
    if [ ! -f .env ]; then
        log_error ".env 파일이 없습니다. .env.example을 복사하여 설정하세요."
        exit 1
    fi
    
    # 필수 환경 변수 확인
    local required_vars=("DB_PASSWORD" "NEXTAUTH_SECRET")
    for var in "${required_vars[@]}"; do
        if ! grep -q "^${var}=" .env; then
            log_error ".env 파일에 ${var}이(가) 설정되어 있지 않습니다."
            exit 1
        fi
    done
    
    log_info "환경 변수 확인 완료"
}

# Docker 상태 확인
check_docker() {
    log_info "Docker 상태 확인 중..."
    
    if ! command -v docker &> /dev/null; then
        log_error "Docker가 설치되어 있지 않습니다."
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        log_error "Docker가 실행되고 있지 않습니다."
        exit 1
    fi
    
    log_info "Docker 확인 완료"
}

# 기존 컨테이너 정리
cleanup() {
    log_info "기존 컨테이너 정리 중..."
    docker compose down --remove-orphans 2>/dev/null || true
    log_info "정리 완료"
}

# Docker Compose 기동 (postgres + redis)
start_docker() {
    log_info "Docker Compose 기동 중..."
    
    docker compose up -d postgres redis
    
    log_info "Docker 기동 완료"
}

# API 서버 기동 (백그라운드)
start_api() {
    log_info "API 서버 기동 중..."
    
    pnpm --filter @aios/api dev &
    API_PID=$!
    echo $API_PID > /tmp/aios-api.pid
    
    log_info "API 서버 기동 중 (PID: $API_PID)"
}

# Web 서버 기동 (백그라운드)
start_web() {
    log_info "Web 서버 기동 중..."
    
    pnpm --filter @aios/web dev &
    WEB_PID=$!
    echo $WEB_PID > /tmp/aios-web.pid
    
    log_info "Web 서버 기동 중 (PID: $WEB_PID)"
}

# 헬스체크
health_check() {
    log_info "헬스체크 수행 중..."
    
    local max_retries=30
    local retry_interval=2
    
    # PostgreSQL 헬스체크
    log_info "PostgreSQL 헬스체크..."
    for i in $(seq 1 $max_retries); do
        if docker compose exec -T postgres pg_isready -U ${DB_USER:-aios} &> /dev/null; then
            log_info "PostgreSQL 정상"
            break
        fi
        if [ $i -eq $max_retries ]; then
            log_error "PostgreSQL 헬스체크 실패"
            return 1
        fi
        sleep $retry_interval
    done
    
    # Redis 헬스체크
    log_info "Redis 헬스체크..."
    for i in $(seq 1 $max_retries); do
        if docker compose exec -T redis redis-cli ping &> /dev/null; then
            log_info "Redis 정상"
            break
        fi
        if [ $i -eq $max_retries ]; then
            log_error "Redis 헬스체크 실패"
            return 1
        fi
        sleep $retry_interval
    done
    
    # API 서버 헬스체크
    log_info "API 서버 헬스체크..."
    for i in $(seq 1 $max_retries); do
        if curl -f http://localhost:${API_PORT:-3200}/health &> /dev/null; then
            log_info "API 서버 정상"
            break
        fi
        if [ $i -eq $max_retries ]; then
            log_error "API 서버 헬스체크 실패"
            return 1
        fi
        sleep $retry_interval
    done
    
    # Web 서버 헬스체크
    log_info "Web 서버 헬스체크..."
    for i in $(seq 1 $max_retries); do
        if curl -f http://localhost:${WEB_PORT:-3110} &> /dev/null; then
            log_info "Web 서버 정상"
            break
        fi
        if [ $i -eq $max_retries ]; then
            log_error "Web 서버 헬스체크 실패"
            return 1
        fi
        sleep $retry_interval
    done
    
    log_info "헬스체크 완료"
}

# 마이그레이션 실행
run_migration() {
    log_info "데이터베이스 마이그레이션 실행 중..."
    
    pnpm --filter @aios/db db:deploy
    
    log_info "마이그레이션 완료"
}

# 리소스 모니터링 시작
start_monitoring() {
    log_info "리소스 모니터링 시작..."
    
    # 백그라운드에서 모니터링 스크립트 실행
    if [ -f scripts/monitor-resources.sh ]; then
        chmod +x scripts/monitor-resources.sh
        nohup scripts/monitor-resources.sh > /var/log/aios-monitor.log 2>&1 &
        log_info "모니터링 시작됨 (PID: $!)"
    else
        log_warn "모니터링 스크립트를 찾을 수 없습니다."
    fi
}

# 상태 출력
print_status() {
    echo ""
    echo "=========================================="
    echo "  AIOS v2 시스템 상태"
    echo "=========================================="
    echo ""
    echo "서비스 URL:"
    echo "  - API 서버: http://localhost:${API_PORT:-3200}"
    echo "  - Web 서버: http://localhost:${WEB_PORT:-3110}"
    echo "  - CEO 대시보드: http://localhost:${WEB_PORT:-3110}/briefing"
    echo ""
    echo "데이터베이스:"
    echo "  - PostgreSQL: localhost:${DB_PORT:-5436}"
    echo "  - Redis: localhost:${REDIS_PORT:-6379}"
    echo ""
    echo "컨테이너 상태:"
    docker compose ps
    echo ""
    echo "=========================================="
}

# 메인 실행
main() {
    log_info "AIOS v2 시스템 기동 시작"
    
    check_env
    check_docker
    cleanup
    start_docker
    health_check
    run_migration
    start_api
    start_web
    start_monitoring
    print_status
    
    log_info "시스템 기동 완료!"
}

# 스크립트 실행
main "$@"
