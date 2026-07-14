import { beforeAll } from "vitest";

import { assertDisposableDatabase } from "./guard-prod-db";

// beforeAll (not top-level): 테스트 파일이 import 시점에 loadEnv(repoRoot/.env)로
// DATABASE_URL을 덮어쓰므로, setupFiles 최상단에서 검사하면 그 값을 보지 못한다.
// CI_INTEGRATION=1일 때만 검사 — 그 외에는 DB 테스트가 skip되어 쓰기가 없다.
beforeAll(() => {
  if (process.env.CI_INTEGRATION === "1") {
    assertDisposableDatabase();
  }
});
