import { SkeletonPage } from "@/components/shell/skeleton-page";

export default function AgentsPage() {
  return (
    <SkeletonPage
      title="Agents"
      description="Agent assignments and runtime policies (Beta)."
      items={[
        { label: "Active agents", value: "1" },
        { label: "Assignments (24h)", value: "—" },
      ]}
    />
  );
}
