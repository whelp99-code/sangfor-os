import { PortalShell } from "@/components/shell/portal-shell";

// CFO pages render live data from the api (/api/cfo) and use client-only
// charts; opt out of static prerender for the whole section.
export const dynamic = "force-dynamic";

// Render CFO inside the shared portal shell so the left sidebar (with the
// Finance group) is present — same frame as the rest of the portal.
export default function CfoLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalShell>
      <main id="main-content" className="flex-1 outline-none">
        {children}
      </main>
    </PortalShell>
  );
}
