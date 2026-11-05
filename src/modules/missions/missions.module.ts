import { Module } from '@nestjs/common';
import { DatabaseModule } from '@database/database.module';
import { AuthModule } from '@modules/auth/auth.module';
import { MissionsController } from '@modules/missions/missions.controller';
import { MissionsService } from '@modules/missions/missions.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [MissionsController],
  providers: [MissionsService],
  exports: [MissionsService],
})
export class MissionsModule {}
