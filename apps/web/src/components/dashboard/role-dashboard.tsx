import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Section = {
  title: string;
  description: string;
  items: { label: string; value: string }[];
};

type RoleDashboardProps = {
  role: string;
  sections: Section[];
};

export function RoleDashboard({ role, sections }: RoleDashboardProps) {
  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6 text-white shadow-xl sm:p-8">
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-blue-500/10 blur-2xl" />
        <div className="relative">
          <p className="text-sm font-medium text-gray-400">Sangfor Agentic OS</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{role}</h1>
          <p className="mt-2 text-sm text-gray-400">
            Role-based operational dashboard
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sections.map((section) => (
          <Card key={section.title}>
            <CardHeader>
              <CardTitle className="text-base">{section.title}</CardTitle>
              <CardDescription>{section.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {section.items.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2"
                >
                  <span className="text-sm text-muted-foreground">{item.label}</span>
                  <span className="text-sm font-semibold">{item.value}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
