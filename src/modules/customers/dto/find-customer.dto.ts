import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';
import { normalizePhone, PHONE_PATTERN } from '../customer-identifiers';

export class FindCustomerDto {
  @Transform(({ value }) => normalizePhone(value))
  @IsString()
  @Matches(PHONE_PATTERN)
  phone: string;
}
