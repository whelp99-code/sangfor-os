/**
 * AiModel 레지스트리 시드 — 데이터분류 게이팅(domain-model-policy)에 실데이터 공급.
 * opencode OpenAI(OAuth)로 보이는 모델을 민감도 허용범위와 함께 등록.
 *
 * 실행: npx tsx packages/business/scripts/seed-ai-models.ts
 */
import { prisma } from "@sangfor/db";

const SEED = [
  { provider: "openai", modelName: "gpt-5.4-mini-fast", allowedDataClassification: ["public", "internal"] },
  { provider: "openai", modelName: "gpt-5.4-fast", allowedDataClassification: ["public", "internal", "confidential"] },
  { provider: "openai", modelName: "gpt-5.4", allowedDataClassification: ["public", "internal", "confidential", "restricted"] },
  { provider: "openai", modelName: "gpt-5.5", allowedDataClassification: ["public", "internal", "confidential", "restricted"] },
];

async function main() {
  let created = 0;
  let updated = 0;
  for (const s of SEED) {
    const existing = await prisma.aiModel.findFirst({
      where: { provider: s.provider, modelName: s.modelName },
    });
    if (existing) {
      await prisma.aiModel.update({
        where: { id: existing.id },
        data: { allowedDataClassification: s.allowedDataClassification, isActive: true },
      });
      updated++;
    } else {
      await prisma.aiModel.create({
        data: { ...s, isActive: true },
      });
      created++;
    }
  }
  const total = await prisma.aiModel.count();
  console.log(`AiModel 시드 완료: 생성 ${created}, 갱신 ${updated} (총 ${total}건)`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("SEED ERROR:", e);
  process.exit(1);
});
