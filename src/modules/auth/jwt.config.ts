import { ConfigService } from '@nestjs/config';
import { JwtModuleOptions } from '@nestjs/jwt';

type ConfigReader = Pick<ConfigService, 'get'>;

export const B2B_JWT_TTL_SECONDS = 24 * 60 * 60;

export function getJwtSecret(config: ConfigReader): string {
  const secret = config.get<string>('JWT_SECRET');
  if (typeof secret !== 'string' || !secret.trim()) {
    throw new Error('JWT_SECRET must be configured.');
  }

  return secret;
}

export function getJwtModuleOptions(config: ConfigReader): JwtModuleOptions {
  return {
    secret: getJwtSecret(config),
    signOptions: { expiresIn: B2B_JWT_TTL_SECONDS, algorithm: 'HS256' },
  };
}
