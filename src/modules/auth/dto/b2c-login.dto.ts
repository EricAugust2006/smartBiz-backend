import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { normalizePhone, PHONE_PATTERN } from '@modules/customers/customer-identifiers';

export class B2cLoginDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString({ message: 'O nome deve ser informado como texto.' })
  @IsNotEmpty({ message: 'O nome é obrigatório.' })
  @MaxLength(120, { message: 'O nome deve ter no máximo 120 caracteres.' })
  name: string;

  @Transform(({ value }: { value: unknown }) => normalizePhone(value))
  @IsString({ message: 'O telefone deve ser informado como texto.' })
  @Matches(PHONE_PATTERN, { message: 'Informe um telefone válido, com DDD.' })
  phone: string;

  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsString({ message: 'A identificação do estabelecimento deve ser um texto.' })
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'A identificação do estabelecimento contém caracteres inválidos.' })
  @MaxLength(80, { message: 'A identificação do estabelecimento deve ter no máximo 80 caracteres.' })
  tenantSlug: string;
}
