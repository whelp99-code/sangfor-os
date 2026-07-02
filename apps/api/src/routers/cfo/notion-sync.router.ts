import { router, financeProcedure } from '../trpc';
import { NotionSyncService } from '../../services/finance';

const notion = new NotionSyncService();

export const notionSyncRouter = router({
  status: financeProcedure
    .query(async () => notion.status()),
  csvImport: financeProcedure
    .mutation(async () => notion.triggerCsvImport()),
});
