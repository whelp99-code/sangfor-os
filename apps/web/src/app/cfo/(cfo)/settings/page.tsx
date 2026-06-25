import { cfoFetch } from "@/lib/cfo-client";

export default async function SettingsPage() {
  let popbill: unknown = null;
  let codef: unknown = null;
  let notion: unknown = null;
  let health: unknown = null;

  try {
    [popbill, codef, notion, health] = await Promise.all([
      cfoFetch("popbill/status").catch(() => ({ error: "unavailable" })),
      cfoFetch("codef/status").catch(() => ({ error: "unavailable" })),
      cfoFetch("notion-sync/status").catch(() => ({ error: "unavailable" })),
      cfoFetch("health/ready").catch(() => ({ error: "unavailable" })),
    ]);
  } catch {
    /* ignore */
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">연동 설정</h1>
      <Section title="API 상태" data={health} />
      <Section title="Popbill (세금계산서)" data={popbill} />
      <Section title="CODEF (금융)" data={codef} />
      <Section title="Notion 동기화" data={notion} />
      <p className="text-sm text-zinc-500">
        환경변수는 repo 루트 <code>.env</code>에서 설정합니다. 자세한 내용은 README와 NOTION_MCP_GUIDE.md를 참고하세요.
      </p>
    </div>
  );
}

function Section({ title, data }: { title: string; data: unknown }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <h2 className="mb-2 font-medium">{title}</h2>
      <pre className="overflow-x-auto text-xs text-zinc-600">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
