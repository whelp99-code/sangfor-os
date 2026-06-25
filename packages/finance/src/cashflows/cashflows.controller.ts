import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CashflowsService, CreateCashflowDto, UpdateCashflowDto } from './cashflows.service';

@Controller('cashflows')
export class CashflowsController {
  constructor(private readonly service: CashflowsService) {}

  @Get()
  list(
    @Query('type') type?: string,
    @Query('projectId') projectId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list({
      type,
      projectId,
      limit: limit ? Number(limit) : 100,
    });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post()
  create(@Body() body: CreateCashflowDto) {
    return this.service.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateCashflowDto) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
