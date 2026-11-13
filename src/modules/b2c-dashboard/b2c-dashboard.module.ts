import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { B2cJwtAuthGuard } from '@common/guards/b2c-jwt-auth.guard';
import { DatabaseModule } from '@database/database.module';
import { B2cJwtStrategy } from '@modules/b2c-dashboard/auth/b2c-jwt.strategy';
import { B2cDashboardController } from '@modules/b2c-dashboard/b2c-dashboard.controller';
import { B2cDashboardService } from '@modules/b2c-dashboard/b2c-dashboard.service';
import { B2cScanService } from '@modules/b2c-dashboard/b2c-scan.service';
import { LoyaltyModule } from '@modules/loyalty/loyalty.module';

@Module({
  imports: [ConfigModule, DatabaseModule, PassportModule, LoyaltyModule],
  controllers: [B2cDashboardController],
  providers: [B2cJwtStrategy, B2cJwtAuthGuard, B2cDashboardService, B2cScanService],
  exports: [B2cDashboardService, B2cScanService],
})
export class B2cDashboardModule {}
