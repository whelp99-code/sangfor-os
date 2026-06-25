/** Track M mail module contract — no OAuth/send/delete in portal body. */

export type MailMessageMeta = {
  id: string;
  subject: string;
  fromAddress: string;
  receivedAt: string;
  groupKey?: string;
  preview?: string;
};

export type MailGroup = {
  key: string;
  label: string;
  messageCount: number;
};

export type TaskCandidate = {
  mailMessageId: string;
  title: string;
  summary: string;
  priority: "normal" | "high";
  entityType?: "customer" | "partner";
  entityId?: string;
};

export type EntityCandidate = {
  email: string;
  customerId?: string;
  partnerId?: string;
  confidence: number;
};

export type MailSyncResult = {
  accounts: number;
  messages: number;
  groups: MailGroup[];
  taskCandidates: TaskCandidate[];
};
