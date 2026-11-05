import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';

import { DatabaseModule } from '@database/database.module';
import { AuthModule } from '@modules/auth/auth.module';
import { TenantsModule } from '@modules/tenants/tenants.module';
import { CustomersModule } from '@modules/customers/customers.module';
import { SalesModule } from '@modules/sales/sales.module';
import { InventoryModule } from '@modules/inventory/inventory.module';
import { MissionsModule } from '@modules/missions/missions.module';
import { AiCopilotModule } from '@modules/ai-copilot/ai-copilot.module';
import { WhatsappModule } from '@modules/whatsapp/whatsapp.module';
import { LoyaltyModule } from '@modules/loyalty/loyalty.module';
import { B2cDashboardModule } from '@modules/b2c-dashboard/b2c-dashboard.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    }),
    DatabaseModule,
    AuthModule,
    TenantsModule,
    CustomersModule,
    SalesModule,
    LoyaltyModule,
    B2cDashboardModule,
    InventoryModule,
    MissionsModule,
    AiCopilotModule,
    WhatsappModule,
  ],
})
export class AppModule {}
