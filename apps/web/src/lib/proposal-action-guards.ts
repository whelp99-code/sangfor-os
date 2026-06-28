import { evaluateProposalAction } from "@sangfor/business";

const PROPOSAL_ACTIONS = ["send", "export", "share"] as const;

type ProposalAction = (typeof PROPOSAL_ACTIONS)[number];

type ProposalActionGuard = ReturnType<typeof evaluateProposalAction>;

export type ProposalActionGuards = Record<ProposalAction, ProposalActionGuard>;

export function buildProposalActionGuards(status: string): ProposalActionGuards {
  return Object.fromEntries(
    PROPOSAL_ACTIONS.map((action) => [
      action,
      evaluateProposalAction({ status, action }),
    ]),
  ) as ProposalActionGuards;
}

export const proposalActionLabels: Record<ProposalAction, string> = {
  send: "Send",
  export: "Export",
  share: "Share",
};
