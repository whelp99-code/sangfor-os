import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('kpi')
  kpi(@Query('year') year?: string, @Query('month') month?: string) {
    const now = new Date();
    return this.service.getKpi(
      year ? Number(year) : now.getFullYear(),
      month ? Number(month) : now.getMonth() + 1,
    );
  }

  @Get('cashflow-forecast')
  forecast(@Query('days') days?: string) {
    return this.service.getCashflowForecast(days ? Number(days) : 90);
  }

  @Get('monthly-trend')
  trend(@Query('months') months?: string) {
    return this.service.getMonthlyTrend(months ? Number(months) : 6);
  }
}
