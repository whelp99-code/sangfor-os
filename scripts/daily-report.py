#!/usr/bin/env python3
"""AIOS v1 Daily Report - Slack Notifier"""
import json
import subprocess
import urllib.request
from datetime import date

TODAY = date.today().isoformat()

# Slack config
SLACK_TOKEN = "SLACK_TOKEN_PLACEHOLDER"
SLACK_CHANNEL = "C0B8JKP4Y3H"

# Query database via docker exec
def query_db(sql):
    result = subprocess.run(
        ["docker", "exec", "ai-portal-postgres", "psql", "-U", "ai_portal", 
         "-d", "ai_automation_portal", "-t", "-A", "-c", sql],
        capture_output=True, text=True
    )
    return result.stdout.strip()

# Gather data
new_mails = query_db("SELECT COUNT(*) FROM mail_messages WHERE created_at >= CURRENT_DATE - INTERVAL '1 day';")
recent_mails = query_db("SELECT subject, from_email FROM mail_messages WHERE created_at >= CURRENT_DATE - INTERVAL '1 day' ORDER BY created_at DESC LIMIT 5;")
thread_count = query_db("SELECT COUNT(*) FROM mail_insight_threads;")
top_threads = query_db("SELECT thread_title FROM mail_insight_threads ORDER BY created_at DESC LIMIT 5;")
candidate_count = query_db("SELECT COUNT(*) FROM mail_derived_candidates;")

# Classification stats
class_stats = query_db("""
    SELECT candidate_type, status, COUNT(*), ROUND(AVG(confidence)) 
    FROM mail_derived_candidates GROUP BY candidate_type, status;
""")

# Entity counts
entity_counts = query_db("""
    SELECT 'customers' as t, COUNT(*) FROM customers
    UNION ALL SELECT 'partners', COUNT(*) FROM partners
    UNION ALL SELECT 'opportunities', COUNT(*) FROM opportunities
    UNION ALL SELECT 'work_tasks', COUNT(*) FROM work_tasks;
""")

# Parse entity counts
entities = {}
for line in entity_counts.split('\n'):
    if '|' in line:
        parts = line.split('|')
        entities[parts[0].strip()] = parts[1].strip()

# Parse classification
converted = {'customer': 0, 'partner': 0, 'opportunity': 0, 'task': 0}
rejected = {'customer': 0, 'partner': 0, 'opportunity': 0, 'task': 0}
confidences = {'customer': [], 'partner': [], 'opportunity': [], 'task': []}

for line in class_stats.split('\n'):
    if '|' in line:
        parts = [p.strip() for p in line.split('|')]
        if len(parts) >= 4:
            ctype, status, count, conf = parts[0], parts[1], int(parts[2]), parts[3]
            if ctype in converted:
                if status == 'converted':
                    converted[ctype] += count
                elif status == 'rejected':
                    rejected[ctype] += count
                confidences[ctype].append(conf)

# Build mail list
mail_lines = []
for line in recent_mails.split('\n'):
    if '|' in line:
        parts = line.split('|')
        mail_lines.append(f"• {parts[0].strip()} - {parts[1].strip()}")

# Build thread list
thread_lines = []
for line in top_threads.split('\n'):
    if line.strip():
        thread_lines.append(f"• {line.strip()}")

# Build classification text
def fmt_conf(confs):
    if confs:
        return f"{min(confs)}~{max(confs)}%"
    return "N/A"

class_text = (
    f"✅ Customer: {converted['customer']}개 변환 / {rejected['customer']}개 거부 (신뢰도 {fmt_conf(confidences['customer'])})\n"
    f"✅ Partner: {converted['partner']}개 변환 (신뢰도 {fmt_conf(confidences['partner'])})\n"
    f"✅ Opportunity: {converted['opportunity']}개 변환 (신뢰도 {fmt_conf(confidences['opportunity'])})\n"
    f"✅ Task: {converted['task']}개 변환 / {rejected['task']}개 거부 (신뢰도 {fmt_conf(confidences['task'])})"
)

# Build Slack blocks
blocks = [
    {
        "type": "header",
        "text": {"type": "plain_text", "text": f"📋 AIOS v1 일일 변경 리포트 ({TODAY})", "emoji": True}
    },
    {
        "type": "section",
        "text": {"type": "mrkdwn", "text": f"📧 *신규 메일 수신 ({new_mails}건)*"}
    },
    {
        "type": "section",
        "text": {"type": "mrkdwn", "text": "\n".join(mail_lines)}
    },
    {"type": "divider"},
    {
        "type": "section",
        "text": {"type": "mrkdwn", "text": f"📚 *메일 스레드 요약 ({thread_count}개)*\n" + "\n".join(thread_lines)}
    },
    {"type": "divider"},
    {
        "type": "section",
        "text": {"type": "mrkdwn", "text": f"🤖 *AI 분류 결과*\n{class_text}"}
    },
    {"type": "divider"},
    {
        "type": "section",
        "text": {"type": "mrkdwn", "text": "📋 *승인 대기 0개*\n(현재 승인 대기 항목 없음)"}
    },
    {"type": "divider"},
    {
        "type": "section",
        "text": {"type": "mrkdwn", "text": (
            f"📊 *주요 지표*\n"
            f"• 총 메일 스레드: {thread_count}개\n"
            f"• 총 메일 후보: {candidate_count}개\n"
            f"• 생성된 고객: {entities.get('customers', '0')}개\n"
            f"• 생성된 파트너: {entities.get('partners', '0')}개\n"
            f"• 생성된 기회: {entities.get('opportunities', '0')}개\n"
            f"• 생성된 작업: {entities.get('work_tasks', '0')}개"
        )}
    },
    {
        "type": "context",
        "elements": [{"type": "mrkdwn", "text": f"🤖 자동 리포트 생성 | Hermes Agent | {TODAY}"}]
    }
]

# Send to Slack
payload = json.dumps({"channel": SLACK_CHANNEL, "text": f"AIOS v1 일일 변경 리포트 {TODAY}", "blocks": blocks})
req = urllib.request.Request(
    "https://slack.com/api/chat.postMessage",
    data=payload.encode(),
    headers={"Authorization": f"Bearer {SLACK_TOKEN}", "Content-Type": "application/json"}
)
resp = urllib.request.urlopen(req)
result = json.loads(resp.read())
print(f"Slack response: {result}")
