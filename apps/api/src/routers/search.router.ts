import { z } from 'zod'
import { router, protectedProcedure } from './trpc'
import { prisma } from '@sangfor/db'

export const searchRouter = router({
  search: protectedProcedure
    .input(z.object({
      q: z.string().optional(),
      type: z.enum(['customers', 'opportunities', 'quotes', 'poc', 'support', 'all']).optional().default('all'),
      filters: z.record(z.any()).optional(),
      page: z.number().min(1).default(1),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const { q, type, page, limit } = input
      const skip = (page - 1) * limit
      const where = q ? { OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ] as any[] } : {}

      let results: any[] = []
      let total = 0

      if (type === 'customers' || type === 'all') {
        const [items, count] = await Promise.all([
          prisma.customer.findMany({ where: where as any, skip, take: limit, orderBy: { createdAt: 'desc' } }),
          prisma.customer.count({ where: where as any }),
        ])
        results = [...results, ...items.map(i => ({ ...i, _type: 'customer' }))]
        total += count
      }
      if (type === 'opportunities' || type === 'all') {
        const [items, count] = await Promise.all([
          prisma.opportunity.findMany({ where: where as any, skip, take: limit, include: { customer: true }, orderBy: { createdAt: 'desc' } }),
          prisma.opportunity.count({ where: where as any }),
        ])
        results = [...results, ...items.map(i => ({ ...i, _type: 'opportunity' }))]
        total += count
      }

      return { results, total, page, limit, totalPages: Math.ceil(total / limit) }
    }),
})
