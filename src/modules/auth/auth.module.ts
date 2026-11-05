import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { DatabaseModule } from '@database/database.module';
import { AuthService } from '@modules/auth/auth.service';
import { JwtStrategy } from '@modules/auth/jwt.strategy';
import { PasswordService } from '@modules/auth/password.service';
import { AuthController } from '@modules/auth/auth.controller';
import { getJwtModuleOptions } from '@modules/auth/jwt.config';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: getJwtModuleOptions,
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, PasswordService],
  exports: [AuthService, PasswordService],
})
export class AuthModule {}
