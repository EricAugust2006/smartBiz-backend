import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthenticatedB2cCustomer } from '@modules/b2c-dashboard/auth/b2c-jwt.strategy';

export const CurrentCustomer = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedB2cCustomer }>();
    if (!request.user) throw new UnauthorizedException();
    return request.user.customerId;
  },
);
