import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Role } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@database/prisma.service';
import { RegisterDto } from '@modules/auth/dto/register.dto';
import { B2B_JWT_TTL_SECONDS } from '@modules/auth/jwt.config';
import { PasswordService } from '@modules/auth/password.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly passwords: PasswordService,
  ) {}

  // Public bootstrap: the tenant is created here, never selected by client input.
  async register(dto: RegisterDto) {
    const slugBase = dto.tenantName.normalize('NFKD').replace(/\p{M}/gu, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      .slice(0, 43).replace(/-+$/g, '') || 'loja';
    const slug = `${slugBase}-${randomUUID()}`;

    try {
      return await this.prisma.$transaction(async (database) => {
        const tenant = await database.tenant.create({
          data: { name: dto.tenantName, slug },
          select: {
            id: true, name: true, slug: true, plan: true,
            whatsappNumber: true, createdAt: true, updatedAt: true,
          },
        });
        const passwordHash = await this.passwords.hash(dto.password);
        const user = await database.user.create({
          data: {
            tenantId: tenant.id, name: dto.userName, email: dto.email,
            passwordHash, role: Role.OWNER,
          },
          select: { id: true, tenantId: true, name: true, email: true, role: true, createdAt: true },
        });
        return { tenant, user };
      }, { timeout: 15000 });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Company or email is already registered.');
      }
      throw error;
    }
  }

  async login(email: string, password: string) {
    // Email is globally unique. The tenant becomes trusted only after credential validation.
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        email: true,
        passwordHash: true,
        role: true,
        tenantId: true,
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            plan: true,
            whatsappNumber: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!user || !(await this.passwords.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const access_token = await this.jwt.signAsync({
      sub: user.id,
      tenantId: user.tenantId,
      role: 'B2B',
      userRole: user.role,
    }, { expiresIn: B2B_JWT_TTL_SECONDS, algorithm: 'HS256' });

    const { passwordHash: _passwordHash, ...publicUser } = user;
    return {
      access_token,
      user: publicUser,
      tenant: user.tenant,
    };
  }
}
