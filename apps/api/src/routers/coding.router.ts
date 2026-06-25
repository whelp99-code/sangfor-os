import { z } from 'zod';
import { router, protectedProcedure, requireRole } from './trpc';

const adminProcedure = protectedProcedure.use(requireRole('admin'));

export interface Project {
  id: string;
  name: string;
  description?: string;
  language: string;
  createdAt: string;
  updatedAt: string;
}

export interface Generation {
  id: string;
  projectId: string;
  prompt: string;
  status: string;
  createdAt: string;
}

const projectsStore: Project[] = [];
const generationsStore: Generation[] = [];

export const codingRouter = router({
  projects: protectedProcedure.query(async () => {
    return { projects: projectsStore };
  }),

  createProject: adminProcedure
    .input(z.object({
      name: z.string(),
      description: z.string().optional(),
      language: z.enum(['typescript', 'python', 'javascript', 'rust', 'go', 'java']),
    }))
    .mutation(async ({ input }) => {
      const project: Project = {
        id: `proj_${Date.now()}`,
        name: input.name,
        description: input.description,
        language: input.language,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      projectsStore.push(project);
      return project;
    }),

  generateCode: adminProcedure
    .input(z.object({ projectId: z.string(), prompt: z.string() }))
    .mutation(async ({ input }) => {
      const generation: Generation = {
        id: `gen_${Date.now()}`,
        projectId: input.projectId,
        prompt: input.prompt,
        status: 'completed',
        createdAt: new Date().toISOString(),
      };
      generationsStore.push(generation);
      return { generationId: generation.id, projectId: input.projectId, status: generation.status };
    }),

  reviewCode: protectedProcedure
    .input(z.object({ generationId: z.string() }))
    .mutation(async ({ input }) => {
      const gen = generationsStore.find(g => g.id === input.generationId);
      if (!gen) {
        return { reviewId: `review_${Date.now()}`, generationId: input.generationId, score: 0, issues: [], suggestions: [], summary: '' };
      }
      return {
        reviewId: `review_${Date.now()}`,
        generationId: input.generationId,
        score: 85,
        issues: ['Consider adding error handling', 'Use stricter types'],
        suggestions: ['Add input validation', 'Refactor long function'],
        summary: `Reviewed ${gen.prompt.slice(0, 40)}...`,
      };
    }),

  generations: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
      const result = generationsStore.filter(g => g.projectId === input.projectId);
      return { generations: result };
    }),
});
