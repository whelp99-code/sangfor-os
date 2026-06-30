export type Deal = {
  id: string;
  title: string;
  stage: string;
  probability: number;
  amount: number | null;
  customer: string | null;
  partner: string | null;
  nextAction: string | null;
  updatedAt: string;
};
