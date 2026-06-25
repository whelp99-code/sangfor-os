import { Module } from '@nestjs/common';
import { CodefService } from './codef.service';
import { CodefController } from './codef.controller';

@Module({
  providers: [CodefService],
  controllers: [CodefController],
  exports: [CodefService],
})
export class CodefModule {}
