import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { VatService } from './vat.service';

@Controller('vat')
export class VatController {
  constructor(private readonly vatService: VatService) {}

  /**
   * GET /api/vat/calculate?year=2026&half=1
   * 부가세 신고 요약 계산
   */
  @Get('calculate')
  async calculate(
    @Query('year') yearStr: string,
    @Query('half') halfStr: string,
  ) {
    const year = Number(yearStr ?? new Date().getFullYear());
    const half = (Number(halfStr ?? 1) === 2 ? 2 : 1) as 1 | 2;
    return this.vatService.calculateVat(year, half);
  }

  /**
   * POST /api/vat/income-tax
   * 종합소득세 예상
   * body: { taxableBase: number }
   */
  @Post('income-tax')
  incomeTax(@Body() body: { taxableBase: number }) {
    return this.vatService.calculateIncomeTax(Number(body?.taxableBase ?? 0));
  }

  /**
   * GET /api/vat/periods?year=2026
   * 해당 연도의 1기/2기 부가세 기간 정보
   */
  @Get('periods')
  periods(@Query('year') yearStr: string) {
    const year = Number(yearStr ?? new Date().getFullYear());
    return [1, 2].map((h) => {
      const bounds = this.vatService.getPeriodBounds(year, h as 1 | 2);
      return {
        year,
        half: h,
        ...bounds,
      };
    });
  }
}
