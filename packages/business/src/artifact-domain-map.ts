export type DomainKey = 'marketing' | 'sales' | 'presales' | 'engineer' | 'cfo';
export const DOMAIN_ORDER: DomainKey[] = ['marketing', 'sales', 'presales', 'engineer', 'cfo'];
export type ArtifactKind =
  | 'meetingNote' | 'proposal' | 'poc' | 'checklist'
  | 'invoice' | 'expense' | 'taxInvoice' | 'lead';

const MAP: Record<ArtifactKind, DomainKey | 'common'> = {
  lead: 'marketing',
  meetingNote: 'common',
  proposal: 'presales',
  poc: 'presales',
  checklist: 'engineer',
  invoice: 'cfo',
  expense: 'cfo',
  taxInvoice: 'cfo',
};
export function domainOfArtifact(kind: ArtifactKind): DomainKey | 'common' {
  return MAP[kind];
}

export interface LaneArtifact { kind: ArtifactKind; id: string; label: string; status?: string; }
export interface DomainLane { domain: DomainKey; status: 'done' | 'active' | 'pending'; artifacts: LaneArtifact[]; autonomy?: import('./project-decision').Autonomy; proposals?: Array<{ id: string; domain: string; title: string; bodyMarkdown: string; createdAt: Date }>; }

export function buildLanes(artifacts: LaneArtifact[]): DomainLane[] {
  // 'common'(meetingNote)은 가장 이른 가능한 도메인(sales)에 임시 귀속해 표시.
  const byDomain = new Map<DomainKey, LaneArtifact[]>();
  for (const d of DOMAIN_ORDER) byDomain.set(d, []);
  for (const a of artifacts) {
    const d = domainOfArtifact(a.kind);
    const target: DomainKey = d === 'common' ? 'sales' : d;
    byDomain.get(target)!.push(a);
  }
  const lastIdx = DOMAIN_ORDER.reduce(
    (acc, d, i) => (byDomain.get(d)!.length > 0 ? i : acc),
    -1,
  );
  // A domain with no artifacts is always 'pending' (honest — empty ≠ done),
  // even if a later domain has progressed. The last domain that DOES have
  // artifacts is 'active'; earlier domains that have artifacts are 'done'.
  return DOMAIN_ORDER.map((domain, i) => {
    const has = byDomain.get(domain)!.length > 0;
    const status: DomainLane['status'] = !has ? 'pending' : i === lastIdx ? 'active' : 'done';
    return { domain, artifacts: byDomain.get(domain)!, status };
  });
}
