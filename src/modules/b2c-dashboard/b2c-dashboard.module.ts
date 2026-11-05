import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { B2cJwtAuthGuard } from '@common/guards/b2c-jwt-auth.guard';
import { DatabaseModule } from '@database/database.module';
import { B2cJwtStrategy } from '@modules/b2c-dashboard/auth/b2c-jwt.strategy';
import { B2cDashboardController } from '@modules/b2c-dashboard/b2c-dashboard.controller';
import { B2cDashboardService } from '@modules/b2c-dashboard/b2c-dashboard.service';

@Module({
  imports: [ConfigModule, DatabaseModule, PassportModule],
  controllers: [B2cDashboardController],
  providers: [B2cJwtStrategy, B2cJwtAuthGuard, B2cDashboardService],
  exports: [B2cDashboardService],
})
export class B2cDashboardModule {}
