import { z } from 'zod';
import { router, protectedProcedure, requireRole } from './trpc';

const adminProcedure = protectedProcedure.use(requireRole('admin'));

const stepSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['action', 'condition', 'parallel', 'loop', 'approval']),
  config: z.record(z.unknown()),
  nextSteps: z.array(z.string()).optional(),
});

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  type: string;
  steps: z.infer<typeof stepSchema>[];
  startStep: string;
  variables?: Record<string, unknown>;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Execution {
  id: string;
  workflowId: string;
  input?: Record<string, unknown>;
  status: string;
  startedAt: string;
}

const workflowStore: Workflow[] = [];
const executionStore: Execution[] = [];

export const workflowRouter = router({
  list: protectedProcedure
    .input(z.object({ status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      let result = [...workflowStore];
      if (input?.status) result = result.filter(w => w.status === input.status);
      return { workflows: result };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const wf = workflowStore.find(w => w.id === input.id);
      if (!wf) {
        return { id: input.id, name: '', status: 'draft' as const, steps: [] };
      }
      return wf;
    }),

  create: adminProcedure
    .input(z.object({
      name: z.string(),
      description: z.string().optional(),
      type: z.string(),
      steps: z.array(stepSchema),
      startStep: z.string(),
      variables: z.record(z.unknown()).optional(),
    }))
    .mutation(async ({ input }) => {
      const wf: Workflow = {
        id: `wf_${Date.now()}`,
        name: input.name,
        description: input.description,
        type: input.type,
        steps: input.steps,
        startStep: input.startStep,
        variables: input.variables,
        status: 'draft',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      workflowStore.push(wf);
      return wf;
    }),

  execute: adminProcedure
    .input(z.object({ workflowId: z.string(), input: z.record(z.unknown()).optional() }))
    .mutation(async ({ input }) => {
      const execution: Execution = {
        id: `exec_${Date.now()}`,
        workflowId: input.workflowId,
        input: input.input,
        status: 'completed',
        startedAt: new Date().toISOString(),
      };
      executionStore.push(execution);
      return { executionId: execution.id, workflowId: input.workflowId, status: execution.status };
    }),

  executions: protectedProcedure
    .input(z.object({ workflowId: z.string() }))
    .query(async ({ input }) => {
      const result = executionStore.filter(e => e.workflowId === input.workflowId);
      return { executions: result };
    }),
});
