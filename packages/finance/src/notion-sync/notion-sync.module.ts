import { Module } from '@nestjs/common';
import { NotionSyncController } from './notion-sync.controller';
import { NotionSyncService } from './notion-sync.service';

@Module({
  controllers: [NotionSyncController],
  providers: [NotionSyncService],
})
export class NotionSyncModule {}
