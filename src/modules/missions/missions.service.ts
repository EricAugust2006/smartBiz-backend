import { Injectable, NotFoundException } from '@nestjs/common';
import { MissionStatus, Prisma } from '@prisma/client';
import { requireTenant } from '@common/utils/require-tenant';
import { PrismaService } from '@database/prisma.service';
import { CreateMissionDto } from '@modules/missions/dto/create-mission.dto';
import { UpdateMissionStatusDto } from '@modules/missions/dto/update-mission-status.dto';

const missionSelect = {
  id: true, tenantId: true, name: true, goalType: true, targetValue: true,
  reward: true, status: true, expiresAt: true, createdAt: true,
} satisfies Prisma.MissionSelect;

@Injectable()
export class MissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateMissionDto) {
    requireTenant(tenantId);
    return this.prisma.mission.create({
      data: {
        tenantId, name: dto.name, goalType: dto.goalType,
        targetValue: new Prisma.Decimal(dto.targetValue), reward: dto.reward,
        status: MissionStatus.ACTIVE,
        expiresAt: dto.expiresAt == null ? null : new Date(dto.expiresAt),
      },
      select: missionSelect,
    });
  }

  async findAll(tenantId: string) {
    requireTenant(tenantId);
    return this.prisma.mission.findMany({
      where: { tenantId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: missionSelect,
    });
  }

  async updateStatus(tenantId: string, id: string, dto: UpdateMissionStatusDto) {
    requireTenant(tenantId);
    try {
      return await this.prisma.mission.update({
        where: { tenantId, id }, data: { status: dto.status }, select: missionSelect,
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Mission not found.');
      }
      throw error;
    }
  }
}
