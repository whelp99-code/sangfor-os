import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IssueTaxInvoiceInput, PopbillService } from './popbill.service';

@Controller('popbill')
export class PopbillController {
  constructor(private readonly service: PopbillService) {}

  /** GET /api/popbill/status - 팝빌 연동 상태 + 잔여 크레딧 */
  @Get('status')
  async status() {
    return this.service.checkStatus();
  }

  /** POST /api/popbill/issue - 세금계산서 발행 */
  @Post('issue')
  issue(@Body() body: IssueTaxInvoiceInput) {
    return this.service.issue(body);
  }

  /** POST /api/popbill/collect-purchase - 홈택스 매입 세금계산서 수집 */
  @Post('collect-purchase')
  collect(@Query('year') year: string, @Query('month') month: string) {
    return this.service.collectPurchaseTaxInvoices(Number(year), Number(month));
  }

  /** GET /api/popbill/history - 발행 이력 */
  @Get('history')
  history(
    @Query('direction') direction?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listHistory({
      direction,
      status,
      limit: limit ? Number(limit) : undefined,
    });
  }

  /** GET /api/popbill/biz-check/:corpNum - 사업자등록 상태 조회 */
  @Get('biz-check/:corpNum')
  checkBiz(@Param('corpNum') corpNum: string) {
    return this.service.checkBizInfo(corpNum);
  }
}
