export const EXTERNAL_MUTATION_CONTAINMENT_CODE = "EXTERNAL_MUTATION_CONTAINED" as const;

export const externalMutationKinds = ["github", "connector_sync", "live_execution"] as const;
export type ExternalMutationKind = (typeof externalMutationKinds)[number];

export class ExternalMutationContainmentError extends Error {
  readonly code = EXTERNAL_MUTATION_CONTAINMENT_CODE;
  readonly mutationKind: ExternalMutationKind;

  constructor(mutationKind: ExternalMutationKind) {
    super(EXTERNAL_MUTATION_CONTAINMENT_CODE);
    this.name = "ExternalMutationContainmentError";
    this.mutationKind = mutationKind;
  }
}

export function denyExternalMutation(mutationKind: ExternalMutationKind): never {
  throw new ExternalMutationContainmentError(mutationKind);
}
