import { ConfigService } from '@nestjs/config';
import { JwtModuleOptions } from '@nestjs/jwt';

type ConfigReader = Pick<ConfigService, 'get'>;

export function getJwtSecret(config: ConfigReader): string {
  const secret = config.get<string>('JWT_SECRET');
  if (!secret) {
    throw new Error('JWT_SECRET must be configured.');
  }

  return secret;
}

export function getJwtModuleOptions(config: ConfigReader): JwtModuleOptions {
  const expiration = config.get<string>('JWT_EXPIRATION') || '7d';
  const match = /^([1-9]\d*)([smhd])$/.exec(expiration);
  if (!match) {
    throw new Error('JWT_EXPIRATION must be a positive duration in s, m, h, or d.');
  }

  const amount = Number(match[1]);
  let multiplier: number;
  switch (match[2]) {
    case 's':
      multiplier = 1;
      break;
    case 'm':
      multiplier = 60;
      break;
    case 'h':
      multiplier = 60 * 60;
      break;
    case 'd':
      multiplier = 24 * 60 * 60;
      break;
    default:
      throw new Error('JWT_EXPIRATION must be a positive duration in s, m, h, or d.');
  }

  return {
    secret: getJwtSecret(config),
    signOptions: { expiresIn: amount * multiplier },
  };
}
