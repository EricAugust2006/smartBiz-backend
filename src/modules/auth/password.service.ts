import { BadRequestException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class PasswordService {
  private readonly saltRounds = 12;

  async hash(password: string): Promise<string> {
    if (bcrypt.truncates(password)) {
      throw new BadRequestException('Password exceeds the supported byte length.');
    }

    return bcrypt.hash(password, this.saltRounds);
  }

  async compare(password: string, passwordHash: string): Promise<boolean> {
    if (bcrypt.truncates(password)) {
      return false;
    }

    return bcrypt.compare(password, passwordHash);
  }
}
