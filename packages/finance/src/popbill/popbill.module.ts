import { Module } from '@nestjs/common';
import { PopbillService } from './popbill.service';
import { PopbillController } from './popbill.controller';

@Module({
  providers: [PopbillService],
  controllers: [PopbillController],
  exports: [PopbillService],
})
export class PopbillModule {}
