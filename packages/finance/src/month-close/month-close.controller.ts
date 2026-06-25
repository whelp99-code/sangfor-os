import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { MonthCloseService } from './month-close.service';

@Controller('month-close')
export class MonthCloseController {
  constructor(private readonly service: MonthCloseService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get('checklist')
  checklist(@Query('year') year: string, @Query('month') month: string) {
    return this.service.runChecklist(Number(year), Number(month));
  }

  @Get(':year/:month')
  get(@Param('year') year: string, @Param('month') month: string) {
    return this.service.get(Number(year), Number(month));
  }

  @Post(':year/:month/start')
  start(@Param('year') year: string, @Param('month') month: string, @Body() body: { notes?: string }) {
    return this.service.start(Number(year), Number(month), body?.notes);
  }

  @Post(':year/:month/complete')
  complete(@Param('year') year: string, @Param('month') month: string) {
    return this.service.complete(Number(year), Number(month));
  }
}
