import { UnauthorizedException } from '@nestjs/common';

export function requireTenant(tenantId: string): void {
  if (typeof tenantId !== 'string' || !tenantId.trim()) {
    throw new UnauthorizedException('A tenant context is required.');
  }
}
