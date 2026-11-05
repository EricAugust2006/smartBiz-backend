import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { getJwtSecret } from '@modules/auth/jwt.config';

export interface AuthenticatedB2cCustomer {
  customerId: string;
  tenantId: string;
  role: 'B2C';
}

@Injectable()
export class B2cJwtStrategy extends PassportStrategy(Strategy, 'b2c-jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(config),
      algorithms: ['HS256'],
    });
  }

  validate(payload: unknown): AuthenticatedB2cCustomer {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new UnauthorizedException();
    }
    if (
      !('sub' in payload) || typeof payload.sub !== 'string' || !payload.sub.trim() ||
      !('tenantId' in payload) || typeof payload.tenantId !== 'string' || !payload.tenantId.trim() ||
      !('role' in payload) || payload.role !== 'B2C' ||
      !('exp' in payload) || typeof payload.exp !== 'number' || !Number.isInteger(payload.exp) ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      throw new UnauthorizedException();
    }
    return { customerId: payload.sub, tenantId: payload.tenantId, role: 'B2C' };
  }
}
