import { router, protectedProcedure } from '../trpc';
import { NotionSyncService } from '../../services/finance';

const notion = new NotionSyncService();

export const notionSyncRouter = router({
  status: protectedProcedure
    .query(async () => notion.status()),
  csvImport: protectedProcedure
    .mutation(async () => notion.triggerCsvImport()),
});
