import { MissionStatus } from '@prisma/client';
import { IsIn } from 'class-validator';

export class UpdateMissionStatusDto {
  @IsIn([MissionStatus.ACTIVE, MissionStatus.INACTIVE])
  status: (typeof MissionStatus)['ACTIVE' | 'INACTIVE'];
}
