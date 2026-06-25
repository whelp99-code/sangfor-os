import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CreateSubscriptionDto, SubscriptionsService } from './subscriptions.service';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly service: SubscriptionsService) {}

  @Get()
  list(@Query('isActive') isActive?: string) {
    return this.service.list({
      isActive: isActive === undefined ? undefined : isActive === 'true',
    });
  }

  @Post()
  create(@Body() body: CreateSubscriptionDto) {
    return this.service.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Partial<CreateSubscriptionDto> & { isActive?: boolean }) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post(':id/advance')
  advance(@Param('id') id: string) {
    return this.service.advanceCycle(id);
  }

  @Get('summary/monthly')
  monthlyTotal() {
    return this.service.getTotalMonthlyCost();
  }

  @Get('summary/by-category')
  byCategory() {
    return this.service.getCategoryBreakdown();
  }

  @Get('upcoming')
  upcoming(@Query('days') days?: string) {
    return this.service.getUpcomingRenewals(days ? Number(days) : 7);
  }
}
