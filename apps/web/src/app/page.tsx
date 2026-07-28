import { resolveActiveCompanyRole } from "@sangfor/auth";
import { prisma } from "@sangfor/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import { roleLandingPath } from "@/lib/auth/role-landing";

export default async function HomePage() {
  const token = (await cookies()).get("session")?.value;
  if (!token) redirect("/login");
  const session = await evaluatePersistedSessionFromRequest(new Request("http://sangfor.local/", {
    headers: { cookie: `session=${encodeURIComponent(token)}` },
  }));
  if (!session.ok) redirect("/login");

  const assignments = await prisma.userCompanyRole.findMany({
    where: { userId: session.userId, companyId: session.companyId },
    select: {
      id: true,
      userId: true,
      companyId: true,
      role: true,
      status: true,
      validFrom: true,
      expiresAt: true,
      revokedAt: true,
    },
  });
  const role = resolveActiveCompanyRole(assignments, new Date());
  if (!role.ok) redirect("/login");
  redirect(roleLandingPath(role.role));
}
