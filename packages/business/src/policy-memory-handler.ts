import { prisma } from "@sangfor/db";

export async function getPolicyMemory(id: string): Promise<unknown> {
  return prisma.policyMemory.findUnique({ where: { id } });
}

export async function updatePolicyMemory(
  id: string,
  data: unknown,
): Promise<unknown> {
  const body = data as { status?: string };
  return prisma.policyMemory.update({
    where: { id },
    data: { status: body.status ?? "active" },
  });
}
