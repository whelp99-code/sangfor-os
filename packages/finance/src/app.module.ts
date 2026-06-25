import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { VatModule } from './vat/vat.module';
import { LedgerModule } from './ledger/ledger.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { MonthCloseModule } from './month-close/month-close.module';
import { ChatbotModule } from './chatbot/chatbot.module';
import { PopbillModule } from './popbill/popbill.module';
import { CodefModule } from './codef/codef.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { HealthModule } from './health/health.module';
import { InvoicesModule } from './invoices/invoices.module';
import { ExpensesModule } from './expenses/expenses.module';
import { ProjectsModule } from './projects/projects.module';
import { CashflowsModule } from './cashflows/cashflows.module';
import { NotionSyncModule } from './notion-sync/notion-sync.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    HealthModule,
    DashboardModule,
    VatModule,
    LedgerModule,
    InvoicesModule,
    ExpensesModule,
    ProjectsModule,
    CashflowsModule,
    SubscriptionsModule,
    MonthCloseModule,
    ChatbotModule,
    PopbillModule,
    CodefModule,
    NotionSyncModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
