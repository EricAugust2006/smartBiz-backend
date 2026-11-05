import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CreateMissionDto } from '@modules/missions/dto/create-mission.dto';
import { UpdateMissionStatusDto } from '@modules/missions/dto/update-mission-status.dto';
import { MissionsService } from '@modules/missions/missions.service';

@Controller('missions')
@UseGuards(JwtAuthGuard)
export class MissionsController {
  constructor(private readonly missions: MissionsService) {}

  @Post()
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateMissionDto) {
    return this.missions.create(tenantId, dto);
  }

  @Get()
  findAll(@CurrentTenant() tenantId: string) {
    return this.missions.findAll(tenantId);
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentTenant() tenantId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateMissionStatusDto,
  ) {
    return this.missions.updateStatus(tenantId, id, dto);
  }
}
