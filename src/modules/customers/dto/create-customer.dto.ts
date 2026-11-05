import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { IsCpf, normalizeCpf, normalizePhone, PHONE_PATTERN } from '../customer-identifiers';

export class CreateCustomerDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @Transform(({ value }) => normalizePhone(value))
  @IsString()
  @Matches(PHONE_PATTERN)
  phone: string;

  @IsOptional()
  @Transform(({ value }) => normalizeCpf(value))
  @IsString()
  @IsCpf()
  cpf?: string;
}
