import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from '@modules/auth/auth.service';
import { B2cLoginDto } from '@modules/auth/dto/b2c-login.dto';
import { LoginDto } from '@modules/auth/dto/login.dto';
import { RegisterDto } from '@modules/auth/dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() body: RegisterDto) {
    return this.auth.register(body);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() body: LoginDto) {
    return this.auth.login(body.email, body.password);
  }

  @Post('b2c')
  @HttpCode(HttpStatus.OK)
  loginB2c(@Body() body: B2cLoginDto) {
    return this.auth.loginB2c(body);
  }
}
