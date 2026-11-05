import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class B2cJwtAuthGuard extends AuthGuard('b2c-jwt') {}
