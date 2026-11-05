import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { getJwtSecret } from '@modules/auth/jwt.config';

export interface AuthenticatedUser {
  userId: string;
  tenantId: string;
  role: 'B2B';
  userRole: Role;
}

function isRole(value: unknown): value is Role {
  return Object.values(Role).some((role) => role === value);
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(config),
      algorithms: ['HS256'],
    });
  }

  validate(payload: unknown): AuthenticatedUser {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new UnauthorizedException();
    }
    if (
      !('sub' in payload) || typeof payload.sub !== 'string' || !payload.sub.trim() ||
      !('tenantId' in payload) || typeof payload.tenantId !== 'string' || !payload.tenantId.trim() ||
      !('role' in payload) || payload.role !== 'B2B' ||
      !('userRole' in payload) || !isRole(payload.userRole) ||
      !('exp' in payload) || typeof payload.exp !== 'number' || !Number.isInteger(payload.exp) ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      throw new UnauthorizedException();
    }

    return {
      userId: payload.sub,
      tenantId: payload.tenantId,
      role: 'B2B',
      userRole: payload.userRole,
    };
  }
}
