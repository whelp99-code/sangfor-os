import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { ChatbotService } from '../../services/finance';

const chatbot = new ChatbotService();

export const chatbotRouter = router({
  tools: protectedProcedure
    .query(async () => chatbot.listTools()),
  chat: protectedProcedure
    .input(z.object({ message: z.string(), history: z.array(z.object({ role: z.string(), content: z.string() })).optional() }))
    .mutation(async ({ input }) => chatbot.chat(input.message, input.history)),
  sessions: protectedProcedure
    .query(async () => chatbot.listSessions()),
  createSession: protectedProcedure
    .input(z.object({ title: z.string().default('새 대화').optional() }))
    .mutation(async ({ input }) => chatbot.createSession(input.title)),
  messages: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input }) => chatbot.getMessages(input.sessionId)),
  sendMessage: protectedProcedure
    .input(z.object({ sessionId: z.string(), content: z.string() }))
    .mutation(async ({ input }) => chatbot.sendMessage(input.sessionId, input.content)),
});
