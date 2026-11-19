import { Transform } from 'class-transformer';
import {
  IsEnum, IsISO8601, IsNotEmpty, IsNumber, IsOptional, IsString,
  Max, MaxLength, Min, Validate,
} from 'class-validator';
import { GoalType } from '@prisma/client';
import { VisitsTargetValidator } from '@modules/missions/validators/visits-target.validator';

export class CreateMissionDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString({ message: 'O nome da missão deve ser um texto.' })
  @IsNotEmpty({ message: 'O nome da missão é obrigatório.' })
  @MaxLength(120, { message: 'O nome da missão deve ter no máximo 120 caracteres.' })
  name: string;

  @IsEnum(GoalType, { message: 'O tipo de meta informado é inválido.' })
  goalType: GoalType;

  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false }, { message: 'O valor da meta deve ser numérico e ter até duas casas decimais.' })
  @Min(0.01, { message: 'O valor da meta deve ser maior que zero.' })
  @Max(9_999_999_999.99, { message: 'O valor da meta excede o limite máximo permitido.' })
  @Validate(VisitsTargetValidator, { message: 'Para metas de visitas, o valor da meta deve ser um número inteiro.' })
  targetValue: number;

  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString({ message: 'A recompensa deve ser um texto.' })
  @IsNotEmpty({ message: 'A recompensa é obrigatória.' })
  @MaxLength(1000, { message: 'A recompensa deve ter no máximo 1.000 caracteres.' })
  reward: string;

  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true }, { message: 'Informe uma data de expiração válida.' })
  expiresAt?: string | null;
}
