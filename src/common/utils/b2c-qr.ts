import { BadRequestException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

export type B2cQrType = 'sale' | 'store';

export interface B2cQrPayload {
  tenantSlug: string;
  type: B2cQrType;
  token?: string;
}

export function createSaleRedemptionToken(
  secret: string,
  redemptionId: string,
  tenantId: string,
  transactionId: string,
  expiresAt: Date,
): string {
  const reference = Buffer.from(redemptionId, 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`${reference}.${tenantId}.${transactionId}.${expiresAt.toISOString()}`)
    .digest('base64url');
  return `${reference}.${signature}`;
}

export function isValidSaleRedemptionToken(
  token: string,
  secret: string,
  redemptionId: string,
  tenantId: string,
  transactionId: string,
  expiresAt: Date,
): boolean {
  const reference = Buffer.from(redemptionId, 'utf8').toString('base64url');
  const [providedReference, providedSignature, extra] = token.split('.');
  if (providedReference !== reference || !providedSignature || extra !== undefined) return false;

  const expected = Buffer.from(createSaleRedemptionToken(
    secret, redemptionId, tenantId, transactionId, expiresAt,
  ).split('.')[1], 'base64url');
  const actual = Buffer.from(providedSignature, 'base64url');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createB2cScanUrl(
  appUrl: string,
  tenantSlug: string,
  type: B2cQrType,
  token?: string,
): string {
  const url = new URL(`/${encodeURIComponent(tenantSlug)}/scan`, appUrl);
  url.searchParams.set('type', type);
  if (token) url.searchParams.set('token', token);
  return url.toString();
}

export function parseB2cQrPayload(value: string): B2cQrPayload {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException('Invalid QR code URL.');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new BadRequestException('Invalid QR code URL.');
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 2 || parts[1] !== 'scan' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parts[0])) {
    throw new BadRequestException('Invalid QR code URL.');
  }
  const types = url.searchParams.getAll('type');
  if (types.length !== 1 || (types[0] !== 'sale' && types[0] !== 'store')) {
    throw new BadRequestException('Invalid QR code type.');
  }

  const tokens = url.searchParams.getAll('token');
  if (types[0] === 'sale') {
    if (tokens.length !== 1 || !tokens[0]) throw new BadRequestException('A sale token is required.');
    return { tenantSlug: parts[0], type: 'sale', token: tokens[0] };
  }
  if (tokens.length !== 0) throw new BadRequestException('Invalid store QR code.');
  return { tenantSlug: parts[0], type: 'store' };
}
