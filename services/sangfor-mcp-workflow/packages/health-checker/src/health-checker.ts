/**
 * 실장비 점검기 — EPP/IAG/CC 정기 정책 상태 확인
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nowId, nowISO, createLogger, type Logger } from '@sangfor/workflow-shared';
import type {
  HealthCheckConfig,
  HealthCheckResult,
  HealthCheckItemResult,
  HealthAlert,
  AlertCondition,
  HealthCheckItem,
} from '@sangfor/workflow-core';

const log = createLogger('health-checker');

// ─── 점검 실행 ──────────────────────────────────────────────────────────────

export async function runHealthCheck(config: HealthCheckConfig): Promise<HealthCheckResult> {
  const checkId = nowId('check');
  const checkedAt = nowISO();

  log.info(`Starting health check for ${config.product} at ${config.targetUrl}`);

  const items: HealthCheckItemResult[] = [];
  const alerts: HealthAlert[] = [];

  // 각 점검 항목에 대해
  for (const checkItem of config.checkItems) {
    log.info(`  Checking: ${checkItem.name}`);

    try {
      // TODO: sangfor-engineer-mcp의 collect_product_config 호출
      // 현재는 목업 데이터 반환
      const collectedData = await collectData(config, checkItem);

      // 알림 조건 검사
      const itemAlerts = checkAlertConditions(checkItem, collectedData);
      alerts.push(...itemAlerts);

      items.push({
        itemId: checkItem.id,
        name: checkItem.name,
        status: itemAlerts.some((a) => a.severity === 'critical')
          ? 'critical'
          : itemAlerts.some((a) => a.severity === 'warning')
            ? 'warning'
            : 'pass',
        collectedData,
      });
    } catch (error) {
      items.push({
        itemId: checkItem.id,
        name: checkItem.name,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      log.error(`  ✗ ${checkItem.name} failed: ${error}`);
    }
  }

  const summary = {
    total: items.length,
    passed: items.filter((i) => i.status === 'pass').length,
    warnings: items.filter((i) => i.status === 'warning').length,
    critical: items.filter((i) => i.status === 'critical').length,
  };

  log.info(`Health check completed: ${summary.passed}/${summary.total} passed`);

  return {
    checkId,
    product: config.product,
    targetUrl: config.targetUrl,
    checkedAt,
    items,
    alerts,
    summary,
  };
}

// ─── 데이터 수집 ────────────────────────────────────────────────────────────

async function collectData(
  config: HealthCheckConfig,
  checkItem: HealthCheckItem,
): Promise<Record<string, unknown>> {
  // TODO: 실제 sangfor-engineer-mcp 연동
  // 현재는 목업 데이터 반환
  return {
    collectedAt: nowISO(),
    product: config.product,
    menuItem: checkItem.name,
    menuPath: checkItem.menuPath,
    data: {},
  };
}

// ─── 알림 조건 검사 ─────────────────────────────────────────────────────────

function checkAlertConditions(
  checkItem: HealthCheckItem,
  collectedData: Record<string, unknown>,
): HealthAlert[] {
  const alerts: HealthAlert[] = [];

  if (!checkItem.alertConditions) {
    return alerts;
  }

  for (const condition of checkItem.alertConditions) {
    const actualValue = getNestedValue(collectedData, condition.field);
    const triggered = evaluateCondition(actualValue, condition);

    if (triggered) {
      alerts.push({
        itemId: checkItem.id,
        itemName: checkItem.name,
        condition,
        actualValue,
        severity: condition.severity,
        message: `${checkItem.name}: ${condition.field} ${condition.operator} ${condition.value} (actual: ${actualValue})`,
      });
    }
  }

  return alerts;
}

function getNestedValue(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current !== null && typeof current === 'object' && key in (current as Record<string, unknown>)) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function evaluateCondition(actualValue: unknown, condition: AlertCondition): boolean {
  switch (condition.operator) {
    case 'equals':
      return actualValue === condition.value;
    case 'not_equals':
      return actualValue !== condition.value;
    case 'contains':
      return String(actualValue).includes(String(condition.value));
    case 'greater_than':
      return Number(actualValue) > Number(condition.value);
    case 'less_than':
      return Number(actualValue) < Number(condition.value);
    default:
      return false;
  }
}

// ─── 스냅샷 저장 ────────────────────────────────────────────────────────────

export function saveHealthCheckSnapshot(
  result: HealthCheckResult,
  outputDir: string
): string {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const filename = `${result.product}_${result.checkedAt.replace(/[:.]/g, '-')}.json`;
  const filepath = join(outputDir, filename);

  writeFileSync(filepath, JSON.stringify(result, null, 2));
  log.info(`Snapshot saved: ${filepath}`);

  return filepath;
}

export function loadHealthCheckSnapshot(filepath: string): HealthCheckResult {
  const content = readFileSync(filepath, 'utf-8');
  return JSON.parse(content) as HealthCheckResult;
}

export function listHealthCheckSnapshots(outputDir: string): string[] {
  if (!existsSync(outputDir)) {
    return [];
  }

  return readdirSync(outputDir)
    .filter((f: string) => f.endsWith('.json'))
    .sort()
    .reverse();
}
