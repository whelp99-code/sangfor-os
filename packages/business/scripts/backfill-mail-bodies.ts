/**
 * Graph에서 저장된 메일의 본문 전문을 다시 받아 채운다.
 *
 * 동기화가 $select에 `body`를 넣지 않아 9개월치 본문이 255자 preview로만 남았다.
 * externalId(Graph message id)가 보존돼 있으므로 건별로 재조회할 수 있다.
 *
 * Usage: tsx packages/business/scripts/backfill-mail-bodies.ts [--limit N] [--apply]
 */
import { prisma } from "@sangfor/db";

import { extractMailBody } from "../src/mail/outlook/mail-body";
import { sanitizeText } from "../src/mail/outlook/outlook-graph";

const GRAPH = "https://graph.microsoft.com/v1.0";
const APPLY = process.argv.includes("--apply");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

async function accessToken(): Promise<string> {
  const account = await prisma.mailAccount.findFirst({
    where: { provider: "outlook", refreshToken: { not: null } },
  });
  if (!account?.refreshToken) throw new Error("Outlook 계정이 OAuth 연결돼 있지 않습니다");

  const res = await fetch(
    `https://login.microsoftonline.com/${process.env.OUTLOOK_TENANT_ID ?? "common"}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.OUTLOOK_CLIENT_ID ?? "",
        client_secret: process.env.OUTLOOK_CLIENT_SECRET ?? "",
        refresh_token: account.refreshToken,
        grant_type: "refresh_token",
      }),
    },
  );
  if (!res.ok) throw new Error(`토큰 갱신 실패 ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; refresh_token?: string };

  if (data.refresh_token) {
    await prisma.mailAccount.update({
      where: { id: account.id },
      data: { accessToken: data.access_token, refreshToken: data.refresh_token },
    });
  }
  return data.access_token;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchBody(token: string, externalId: string, attempt = 0): Promise<unknown> {
  const res = await fetch(`${GRAPH}/me/messages/${externalId}?$select=body`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  // Graph는 대량 조회에 429/503로 백프레셔를 건다. Retry-After를 지키지 않으면
  // 계정 단위로 더 길게 막힌다.
  if ((res.status === 429 || res.status === 503) && attempt < 5) {
    const wait = Number(res.headers.get("Retry-After") ?? 5) * 1000;
    await sleep(wait);
    return fetchBody(token, externalId, attempt + 1);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Graph ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = (await res.json()) as { body?: { contentType?: string; content?: string } };
  return data.body;
}

async function main() {
  const pending = await prisma.mailMessage.findMany({
    where: { externalId: { not: null }, body: null },
    select: { id: true, externalId: true, subject: true },
    orderBy: { receivedAt: "asc" },
    take: Number.isFinite(LIMIT) ? LIMIT : undefined,
  });

  console.log(`본문 없는 메일: ${pending.length}건${APPLY ? "" : " (dry-run — --apply로 실제 저장)"}`);
  if (pending.length === 0) return;

  const token = await accessToken();
  let filled = 0;
  let empty = 0;
  let missing = 0;
  const lengths: number[] = [];

  for (const [i, mail] of pending.entries()) {
    try {
      const raw = await fetchBody(token, mail.externalId!);
      if (raw === null) {
        missing++;
        continue;
      }
      const { body, format } = extractMailBody(
        raw as { contentType?: string; content?: string } | undefined,
      );
      if (!body) {
        empty++;
        continue;
      }
      lengths.push(body.length);
      filled++;
      if (APPLY) {
        await prisma.mailMessage.update({
          where: { id: mail.id },
          data: { body: sanitizeText(body), bodyFormat: format },
        });
      }
    } catch (error) {
      console.error(`[${i}] ${mail.subject?.slice(0, 40)}: ${(error as Error).message}`);
    }
    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${pending.length} …`);
    await sleep(60);
  }

  lengths.sort((a, b) => a - b);
  const median = lengths[Math.floor(lengths.length / 2)] ?? 0;
  console.log(
    `\n본문 확보 ${filled} · 빈본문 ${empty} · Graph에 없음 ${missing}` +
      `\n길이 중앙값 ${median}자 / 최대 ${lengths.at(-1) ?? 0}자`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
