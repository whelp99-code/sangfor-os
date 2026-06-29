import { describe, it, expect } from 'vitest';
import { domainOfArtifact, buildLanes, DOMAIN_ORDER } from './artifact-domain-map';

describe('domainOfArtifact', () => {
  it('maps known artifact kinds to domains', () => {
    expect(domainOfArtifact('proposal')).toBe('presales');
    expect(domainOfArtifact('poc')).toBe('presales');
    expect(domainOfArtifact('checklist')).toBe('engineer');
    expect(domainOfArtifact('taxInvoice')).toBe('cfo');
    expect(domainOfArtifact('invoice')).toBe('cfo');
    expect(domainOfArtifact('lead')).toBe('marketing');
    expect(domainOfArtifact('meetingNote')).toBe('common');
  });
});
describe('buildLanes', () => {
  it('produces 5 lanes in order with status derived from where artifacts exist', () => {
    const lanes = buildLanes([
      { kind: 'lead', id: 'l1', label: 'KB 메일' },
      { kind: 'proposal', id: 'p1', label: '제안서 v2' },
    ]);
    expect(lanes.map((l) => l.domain)).toEqual(DOMAIN_ORDER);
    expect(lanes.find((l) => l.domain === 'marketing')!.status).toBe('done');
    expect(lanes.find((l) => l.domain === 'presales')!.status).toBe('active'); // last with artifacts
    expect(lanes.find((l) => l.domain === 'engineer')!.status).toBe('pending');
    expect(lanes.find((l) => l.domain === 'presales')!.artifacts).toHaveLength(1);
  });
  it('empty artifacts → all pending', () => {
    expect(buildLanes([]).every((l) => l.status === 'pending')).toBe(true);
  });
});
