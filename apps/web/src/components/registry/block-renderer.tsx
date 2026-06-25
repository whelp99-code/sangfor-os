import { MetricsBlock } from "@/components/blocks/metrics-block";
import type { PageBlock } from "@/lib/registry/service";

const BLOCK_MAP = {
  "dashboard-metrics": MetricsBlock,
  "registry-stats": MetricsBlock,
  "command-run-summary": MetricsBlock,
} as const;

type BlockRendererProps = {
  blocks: PageBlock[];
};

export function BlockRenderer({ blocks }: BlockRendererProps) {
  if (!blocks.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No blocks registered for this page yet.
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      {blocks.map((block) => {
        const Component =
          BLOCK_MAP[block.blockKey as keyof typeof BLOCK_MAP] ?? MetricsBlock;
        return (
          <Component
            key={`${block.slotKey}-${block.blockKey}`}
            title={block.displayName}
            data={block.data as never}
          />
        );
      })}
    </div>
  );
}
