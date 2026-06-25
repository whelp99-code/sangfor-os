import { PortalShell } from "@/components/shell/portal-shell"

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100]
        focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium
        focus:text-brand-600 focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-brand-500">
        본문으로 건너뛰기
      </a>
      <PortalShell>
        <main id="main-content" className="flex-1 outline-none">
          {children}
        </main>
      </PortalShell>
    </>
  )
}
