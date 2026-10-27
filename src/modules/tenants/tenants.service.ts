import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { PasswordService } from '../auth/password.service';
import { CreateTenantDto } from './dto/create-tenant.dto';

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  async create(dto: CreateTenantDto) {
    const passwordHash = await this.passwords.hash(dto.password);

    try {
      const created = await this.prisma.$transaction((transaction) =>
        transaction.tenant.create({
          data: {
            name: dto.name,
            slug: dto.slug,
            whatsappNumber: dto.whatsappNumber,
            users: {
              create: {
                name: dto.ownerName,
                email: dto.email,
                passwordHash,
                role: Role.OWNER,
              },
            },
          },
          select: {
            id: true,
            name: true,
            slug: true,
            plan: true,
            whatsappNumber: true,
            createdAt: true,
            updatedAt: true,
            users: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
                createdAt: true,
              },
            },
          },
        }),
      );

      const { users, ...tenant } = created;
      return { tenant, owner: users[0] };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Company slug or email is already in use.');
      }

      throw error;
    }
  }

  async findById(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        slug: true,
        plan: true,
        whatsappNumber: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!tenant) {
      throw new NotFoundException('Company not found.');
    }

    return tenant;
  }
}
