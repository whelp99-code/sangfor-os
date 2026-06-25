#!/bin/bash
# Mac Mini 리소스 모니터링 스크립트
# 
# CPU/RAM/디스크 사용량을 모니터링하고
# 임계값 초과 시 Telegram 알림을 발송한다.

set -e

# 설정
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
CPU_THRESHOLD=80      # CPU 사용량 임계값 (%)
RAM_THRESHOLD=80      # RAM 사용량 임계값 (%)
DISK_THRESHOLD=80     # 디스크 사용량 임계값 (%)
CHECK_INTERVAL=300    # 체크 간격 (초)

# 로그 파일
LOG_FILE="/var/log/aios-resource-monitor.log"

# 로그 함수
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Telegram 알림 발송
send_telegram_alert() {
    local message="$1"
    
    if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ]; then
        log "WARNING: Telegram credentials not set. Skipping alert."
        return
    fi
    
    local url="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage"
    local response=$(curl -s -X POST "$url" \
        -H "Content-Type: application/json" \
        -d "{\"chat_id\": \"${TELEGRAM_CHAT_ID}\", \"text\": \"${message}\", \"parse_mode\": \"HTML\"}")
    
    if echo "$response" | grep -q '"ok":true'; then
        log "Telegram alert sent successfully"
    else
        log "ERROR: Failed to send Telegram alert"
    fi
}

# CPU 사용량 확인
check_cpu() {
    local cpu_usage=$(top -l 1 | grep "CPU usage" | awk '{print $3}' | sed 's/%//')
    cpu_usage=${cpu_usage%.*}  # 소수점 제거
    
    if [ "$cpu_usage" -ge "$CPU_THRESHOLD" ]; then
        log "WARNING: CPU usage is ${cpu_usage}% (threshold: ${CPU_THRESHOLD}%)"
        send_telegram_alert "⚠️ CPU 사용량 경고

현재: ${cpu_usage}%
임계값: ${CPU_THRESHOLD}%
시간: $(date '+%Y-%m-%d %H:%M:%S')"
        return 1
    fi
    
    log "CPU usage: ${cpu_usage}% (OK)"
    return 0
}

# RAM 사용량 확인
check_ram() {
    local total_mem=$(sysctl -n hw.memsize | awk '{print $1/1024/1024/1024}')
    local used_mem=$(vm_stat | grep "Pages active" | awk '{print $3}' | sed 's/\.//')
    local free_mem=$(vm_stat | grep "Pages free" | awk '{print $3}' | sed 's/\.//')
    
    # 페이지 크기 (4KB)
    local page_size=4096
    local used_gb=$(echo "scale=2; $used_mem * $page_size / 1024 / 1024 / 1024" | bc)
    local ram_usage=$(echo "scale=0; $used_gb * 100 / $total_mem" | bc)
    
    if [ "$ram_usage" -ge "$RAM_THRESHOLD" ]; then
        log "WARNING: RAM usage is ${ram_usage}% (threshold: ${RAM_THRESHOLD}%)"
        send_telegram_alert "⚠️ RAM 사용량 경고

현재: ${ram_usage}%
임계값: ${RAM_THRESHOLD}%
시간: $(date '+%Y-%m-%d %H:%M:%S')"
        return 1
    fi
    
    log "RAM usage: ${ram_usage}% (OK)"
    return 0
}

# 디스크 사용량 확인
check_disk() {
    local disk_usage=$(df -h / | tail -1 | awk '{print $5}' | sed 's/%//')
    
    if [ "$disk_usage" -ge "$DISK_THRESHOLD" ]; then
        log "WARNING: Disk usage is ${disk_usage}% (threshold: ${DISK_THRESHOLD}%)"
        send_telegram_alert "⚠️ 디스크 사용량 경고

현재: ${disk_usage}%
임계값: ${DISK_THRESHOLD}%
시간: $(date '+%Y-%m-%d %H:%M:%S')"
        return 1
    fi
    
    log "Disk usage: ${disk_usage}% (OK)"
    return 0
}

# Docker 컨테이너 상태 확인
check_docker() {
    local unhealthy=$(docker ps --filter "health=unhealthy" --format "{{.Names}}" 2>/dev/null)
    
    if [ -n "$unhealthy" ]; then
        log "WARNING: Unhealthy Docker containers: $unhealthy"
        send_telegram_alert "⚠️ Docker 컨테이너 상태 경고

비정상 컨테이너:
${unhealthy}

시간: $(date '+%Y-%m-%d %H:%M:%S')"
        return 1
    fi
    
    log "Docker containers: All healthy (OK)"
    return 0
}

# 전체 리소스 리포트 생성
generate_report() {
    local cpu_usage=$(top -l 1 | grep "CPU usage" | awk '{print $3}')
    local disk_usage=$(df -h / | tail -1 | awk '{print $5}')
    
    cat << EOF
📊 Mac Mini 리소스 리포트
시간: $(date '+%Y-%m-%d %H:%M:%S')

CPU: ${cpu_usage}
디스크: ${disk_usage}

Docker 컨테이너:
$(docker ps --format "table {{.Names}}\t{{.Status}}" 2>/dev/null || echo "Docker not running")
EOF
}

# 메인 모니터링 루프
main() {
    log "Starting resource monitoring..."
    log "Thresholds: CPU=${CPU_THRESHOLD}%, RAM=${RAM_THRESHOLD}%, Disk=${DISK_THRESHOLD}%"
    
    while true; do
        local alerts=0
        
        check_cpu || alerts=$((alerts + 1))
        check_ram || alerts=$((alerts + 1))
        check_disk || alerts=$((alerts + 1))
        check_docker || alerts=$((alerts + 1))
        
        if [ $alerts -gt 0 ]; then
            log "Total alerts: $alerts"
        fi
        
        sleep $CHECK_INTERVAL
    done
}

# 단일 체크 모드 (테스트용)
if [ "$1" = "--check" ]; then
    echo "$(generate_report)"
    echo ""
    echo "=== 리소스 체크 ==="
    check_cpu
    check_ram
    check_disk
    check_docker
    exit 0
fi

# 모니터링 시작
main
