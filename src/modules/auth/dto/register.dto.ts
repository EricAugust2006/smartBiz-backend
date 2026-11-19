import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString({ message: 'O nome do estabelecimento deve ser um texto.' })
  @IsNotEmpty({ message: 'O nome do estabelecimento é obrigatório.' })
  @MaxLength(120, { message: 'O nome do estabelecimento deve ter no máximo 120 caracteres.' })
  tenantName: string;

  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString({ message: 'O nome do usuário deve ser um texto.' })
  @IsNotEmpty({ message: 'O nome do usuário é obrigatório.' })
  @MaxLength(120, { message: 'O nome do usuário deve ter no máximo 120 caracteres.' })
  userName: string;

  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsEmail({}, { message: 'Informe um endereço de e-mail válido.' })
  @MaxLength(254, { message: 'O e-mail deve ter no máximo 254 caracteres.' })
  email: string;

  @IsString({ message: 'A senha deve ser informada como texto.' })
  @MinLength(8, { message: 'A senha deve ter pelo menos 8 caracteres.' })
  @MaxLength(128, { message: 'A senha deve ter no máximo 128 caracteres.' })
  password: string;
}
