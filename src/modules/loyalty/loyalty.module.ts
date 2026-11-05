import { Module } from '@nestjs/common';
import { DatabaseModule } from '@database/database.module';
import { LoyaltyOutboxConsumer } from '@modules/loyalty/loyalty-outbox.consumer';
import { LoyaltyService } from '@modules/loyalty/loyalty.service';

@Module({
  imports: [DatabaseModule],
  providers: [LoyaltyService, LoyaltyOutboxConsumer],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
