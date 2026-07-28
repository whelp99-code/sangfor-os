export const dynamic = "force-dynamic";

import { prisma } from "@sangfor/db";
import { EligibilityMatrix } from "@/components/delivery/people/eligibility-matrix";

export default async function DeliveryPeoplePage() {
  const people = await prisma.userCompanyRole.findMany({
    where: { status: "active" },
    take: 50,
  });

  const formattedPeople = people.map((p) => ({
    id: p.id,
    userId: p.userId,
    role: p.role,
    status: p.status ?? "active",
  }));

  return (
    <div className="p-6 space-y-6 bg-zinc-950 min-h-screen text-zinc-100">
      <div>
        <h1 className="text-xl font-bold text-cyan-400">Delivery Roster & Engineer Credentials</h1>
        <p className="text-xs text-zinc-400 mt-1">
          Server-evaluated eligibility matrix based on issuer certifications and skills.
        </p>
      </div>

      <EligibilityMatrix people={formattedPeople} />
    </div>
  );
}
