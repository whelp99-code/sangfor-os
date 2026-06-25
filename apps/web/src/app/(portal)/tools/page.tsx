import { SkeletonPage } from "@/components/shell/skeleton-page";

export default function ToolsPage() {
  return (
    <SkeletonPage
      title="Tools"
      description="Tool call registry and dry-run connectors (Beta)."
      items={[
        { label: "Registered tools", value: "2" },
        { label: "Succeeded (24h)", value: "—" },
      ]}
    />
  );
}
