import { Controller, Get, Post } from '@nestjs/common';
import { NotionSyncService } from './notion-sync.service';

@Controller('notion-sync')
export class NotionSyncController {
  constructor(private readonly service: NotionSyncService) {}

  @Get('status')
  status() {
    return this.service.status();
  }

  @Post('csv-import')
  triggerCsvImport() {
    return this.service.triggerCsvImport();
  }
}
