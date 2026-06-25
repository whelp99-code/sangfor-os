import { z } from 'zod';
import { router, protectedProcedure, requireRole } from './trpc';

const adminProcedure = protectedProcedure.use(requireRole('admin'));

export interface MailItem {
  id: string;
  subject: string;
  from: string;
  body: string;
  status: 'unread' | 'read' | 'archived';
  analyzed: boolean;
  analysis?: {
    summary: string;
    category: string;
    priority: string;
    sentiment: string;
    actionItems: string[];
    entities: string[];
    confidence: number;
  };
  createdAt: string;
}

const mailStore: MailItem[] = [];

export const mailRouter = router({
  create: adminProcedure
    .input(z.object({
      subject: z.string(),
      from: z.string(),
      body: z.string(),
    }))
    .mutation(async ({ input }) => {
      const mail: MailItem = {
        id: `mail_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        subject: input.subject,
        from: input.from,
        body: input.body,
        status: 'unread',
        analyzed: false,
        createdAt: new Date().toISOString(),
      };
      mailStore.push(mail);
      return mail;
    }),

  list: protectedProcedure
    .input(z.object({ limit: z.number().optional().default(50), offset: z.number().optional().default(0) }).optional())
    .query(async ({ input }) => {
      const limit = input?.limit ?? 50;
      const offset = input?.offset ?? 0;
      const mails = mailStore.slice(offset, offset + limit);
      return { mails, total: mailStore.length, limit, offset };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const mail = mailStore.find(m => m.id === input.id);
      if (!mail) {
        return { id: input.id, subject: '', from: '', body: '', status: 'unread' as const };
      }
      return mail;
    }),

  analyze: adminProcedure
    .input(z.object({ mailId: z.string() }))
    .mutation(async ({ input }) => {
      const mail = mailStore.find(m => m.id === input.mailId);
      if (!mail) {
        return {
          mailId: input.mailId,
          analysis: { summary: '', category: 'unknown', priority: 'medium', sentiment: 'neutral', actionItems: [], entities: [], confidence: 0 },
        };
      }
      mail.analyzed = true;
      mail.analysis = {
        summary: `Auto-analyzed: ${mail.subject}`,
        category: 'general',
        priority: 'medium',
        sentiment: 'neutral',
        actionItems: [],
        entities: [],
        confidence: 0.85,
      };
      return { mailId: input.mailId, analysis: mail.analysis };
    }),

  archive: adminProcedure
    .input(z.object({ mailId: z.string(), reason: z.string().optional() }))
    .mutation(async ({ input }) => {
      const mail = mailStore.find(m => m.id === input.mailId);
      if (mail) mail.status = 'archived';
      return { success: true, mailId: input.mailId };
    }),

  markAsRead: adminProcedure
    .input(z.object({ mailId: z.string() }))
    .mutation(async ({ input }) => {
      const mail = mailStore.find(m => m.id === input.mailId);
      if (mail) mail.status = 'read';
      return { success: true, mailId: input.mailId };
    }),

  stats: protectedProcedure.query(async () => {
    const total = mailStore.length;
    const unread = mailStore.filter(m => m.status === 'unread').length;
    const analyzed = mailStore.filter(m => m.analyzed).length;
    return { total, unread, analyzed };
  }),
});
