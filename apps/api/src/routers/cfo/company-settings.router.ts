import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { prisma } from '@sangfor/db';
import {
  getCompanyBusinessNumber,
  setCompanySettings,
} from '../../services/finance/company-settings.service';

export const companySettingsRouter = router({
  get: protectedProcedure.query(async () => {
    try {
      const businessNumber = await getCompanyBusinessNumber();
      const settings = await prisma.companySettings.findUnique({ where: { id: 'default' } });
      return {
        businessNumber,
        companyName: settings?.companyName ?? undefined,
        ceoName: settings?.ceoName ?? undefined,
      };
    } catch {
      return { businessNumber: '' };
    }
  }),

  set: protectedProcedure
    .input(
      z.object({
        businessNumber: z.string().min(10),
        companyName: z.string().optional(),
        ceoName: z.string().optional(),
      }),
    )
    .mutation(({ input }) => setCompanySettings(input)),
});
