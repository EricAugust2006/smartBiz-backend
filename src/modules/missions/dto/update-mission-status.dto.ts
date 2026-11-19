import { MissionStatus } from '@prisma/client';
import { IsIn } from 'class-validator';

export class UpdateMissionStatusDto {
  @IsIn([MissionStatus.ACTIVE, MissionStatus.INACTIVE], { message: 'O status da missão deve ser ativo ou inativo.' })
  status: (typeof MissionStatus)['ACTIVE' | 'INACTIVE'];
}
