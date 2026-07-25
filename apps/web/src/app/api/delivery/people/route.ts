import { NextResponse, type NextRequest } from "next/server";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";

export async function GET(req: NextRequest) {
  try {
    const session = await evaluatePersistedSessionFromRequest(req);
    if (!session.ok) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { prisma } = await import("@sangfor/db");
    const people = await prisma.userCompanyRole.findMany({
      where: { companyId: session.companyId, status: "active" },
      take: 50,
    });

    return NextResponse.json({ people, count: people.length }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
