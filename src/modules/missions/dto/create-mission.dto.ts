import { Transform } from 'class-transformer';
import {
  IsEnum, IsISO8601, IsNotEmpty, IsNumber, IsOptional, IsString,
  Max, MaxLength, Min, Validate,
} from 'class-validator';
import { GoalType } from '@prisma/client';
import { VisitsTargetValidator } from '@modules/missions/validators/visits-target.validator';

export class CreateMissionDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsEnum(GoalType)
  goalType: GoalType;

  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0.01)
  @Max(9_999_999_999.99)
  @Validate(VisitsTargetValidator)
  targetValue: number;

  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reward: string;

  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  expiresAt?: string | null;
}
