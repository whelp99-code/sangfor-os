export const dynamic = "force-dynamic";

export default function SupportPoliciesPage() {
  return (
    <div className="p-6 space-y-6 bg-zinc-950 min-h-screen text-zinc-100">
      <div>
        <h1 className="text-xl font-bold text-amber-400">Support SLA Policies & SLA Clock Rules</h1>
        <p className="text-xs text-zinc-400 mt-1">
          24x7 SLA targets and immutable snapshot versioning.
        </p>
      </div>

      <div className="p-4 border rounded-lg bg-zinc-900 space-y-3 text-xs">
        <h3 className="font-semibold text-sm text-zinc-200">Default 24x7 SLA Matrix</h3>
        <ul className="space-y-2 font-mono">
          <li>Critical: Response 60m / Resolution 240m (4h)</li>
          <li>High: Response 240m (4h) / Resolution 1440m (24h)</li>
          <li>Medium: Response 1440m (24h) / Resolution 2880m (48h)</li>
          <li>Low: Response 1440m (24h) / Resolution 4320m (72h)</li>
        </ul>
      </div>
    </div>
  );
}
