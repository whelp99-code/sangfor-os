import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CodefService } from './codef.service';

@Controller('codef')
export class CodefController {
  constructor(private readonly service: CodefService) {}

  @Get('status')
  status() {
    return { enabled: this.service.isEnabled() };
  }

  @Get('accounts')
  list(@Query('type') type?: 'bank' | 'card') {
    return this.service.listAccounts(type);
  }

  @Post('accounts/connect')
  connect(@Body() body: { type: 'bank' | 'card'; organization: string; accountName: string; accountNum?: string; memo?: string }) {
    return this.service.connectAccount(body);
  }

  @Post('accounts/:id/sync')
  sync(@Param('id') id: string, @Body() body: { fromDate: string; toDate: string }) {
    return this.service.syncTransactions(
      id,
      new Date(body.fromDate),
      new Date(body.toDate),
    );
  }

  @Get('expiring')
  expiring(@Query('days') days?: string) {
    return this.service.getExpiringSoon(days ? Number(days) : 7);
  }
}
