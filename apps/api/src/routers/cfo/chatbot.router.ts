import { z } from 'zod';
import { router, financeProcedure } from '../trpc';
import { ChatbotService } from '../../services/finance';

const chatbot = new ChatbotService();

export const chatbotRouter = router({
  tools: financeProcedure
    .query(async () => chatbot.listTools()),
  chat: financeProcedure
    .input(z.object({ message: z.string(), history: z.array(z.object({ role: z.string(), content: z.string() })).optional() }))
    .mutation(async ({ input }) => chatbot.chat(input.message, input.history)),
  sessions: financeProcedure
    .query(async () => chatbot.listSessions()),
  createSession: financeProcedure
    .input(z.object({ title: z.string().default('새 대화').optional() }))
    .mutation(async ({ input }) => chatbot.createSession(input.title)),
  messages: financeProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input }) => chatbot.getMessages(input.sessionId)),
  sendMessage: financeProcedure
    .input(z.object({ sessionId: z.string(), content: z.string() }))
    .mutation(async ({ input }) => chatbot.sendMessage(input.sessionId, input.content)),
});
