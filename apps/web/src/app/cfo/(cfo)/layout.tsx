import { PortalShell } from "@/components/shell/portal-shell";
import { CfoSubnav } from "@/components/cfo/cfo-subnav";
import { cookies } from "next/headers";

import { verifySessionToken } from "@/lib/auth/session";

// CFO pages render live data from the api (/api/cfo) and use client-only
// charts; opt out of static prerender for the whole section.
export const dynamic = "force-dynamic";

// Render CFO inside the shared portal shell so the left sidebar (with the
// Finance group) is present — same frame as the rest of the portal.
export default async function CfoLayout({ children }: { children: React.ReactNode }) {
  const session = verifySessionToken((await cookies()).get("session")?.value);

  // CFO pages fetch with a server-side finance credential. Apply the portal
  // role gate before rendering so a viewer cannot inherit that credential's
  // visibility through SSR.
  if (session?.role === "viewer") {
    return (
      <PortalShell>
        <main id="main-content" className="flex-1 p-6 outline-none">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            재무 정보는 관리자와 운영 담당자만 볼 수 있습니다.
          </div>
        </main>
      </PortalShell>
    );
  }

  return (
    <PortalShell>
      <main id="main-content" className="flex-1 outline-none">
        <CfoSubnav />
        {children}
      </main>
    </PortalShell>
  );
}
