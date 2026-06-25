import { Module } from '@nestjs/common';
import { MonthCloseService } from './month-close.service';
import { MonthCloseController } from './month-close.controller';

@Module({
  providers: [MonthCloseService],
  controllers: [MonthCloseController],
  exports: [MonthCloseService],
})
export class MonthCloseModule {}
