const PROD_DB_NAMES = ["sangfor_os"];

function databaseName(url: string): string | null {
  try {
    return new URL(url).pathname.replace(/^\//, "") || null;
  } catch {
    return null;
  }
}

/**
 * DB를 쓰는 통합 테스트가 레포 루트 .env를 상속해 운영 DB(sangfor_os)에 그대로
 * 붙던 문제를 차단한다. 2026-07-13 드리프트에서 고아 로그 56행이 운영 DB에 남았다.
 */
export function assertDisposableDatabase(url = process.env.DATABASE_URL): void {
  if (!url) return;
  const name = databaseName(url);
  if (name && PROD_DB_NAMES.includes(name)) {
    throw new Error(
      `[test-guard] DATABASE_URL이 운영 DB('${name}')를 가리킵니다. ` +
        `통합 테스트는 폐기 가능한 DB에서만 실행하세요 ` +
        `(예: DATABASE_URL=postgresql://…/sangfor_os_test).`,
    );
  }
}
