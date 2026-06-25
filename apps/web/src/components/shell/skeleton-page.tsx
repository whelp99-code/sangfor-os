import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type SkeletonPageProps = {
  title: string;
  description: string;
  items: { label: string; value: string }[];
};

export function SkeletonPage({ title, description, items }: SkeletonPageProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <Card key={item.label}>
            <CardHeader>
              <CardTitle className="text-base">{item.label}</CardTitle>
              <CardDescription>Mock read model (Phase 2)</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{item.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
