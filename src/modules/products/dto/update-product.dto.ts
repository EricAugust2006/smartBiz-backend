import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsNotEmpty, IsNumber, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export class UpdateProductDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString({ message: 'O nome do produto deve ser um texto.' })
  @IsNotEmpty({ message: 'O nome do produto é obrigatório.' })
  @MaxLength(120, { message: 'O nome do produto deve ter no máximo 120 caracteres.' })
  name?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false }, { message: 'O preço deve ser um valor numérico válido, com até duas casas decimais.' })
  @Min(0, { message: 'O preço não pode ser negativo.' })
  @Max(99_999_999.99, { message: 'O preço excede o limite máximo permitido.' })
  price?: number;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString({ message: 'A categoria do produto deve ser um texto.' })
  @IsNotEmpty({ message: 'A categoria do produto é obrigatória.' })
  @MaxLength(120, { message: 'A categoria do produto deve ter no máximo 120 caracteres.' })
  category?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean({ message: 'O status do produto deve ser verdadeiro ou falso.' })
  isActive?: boolean;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false }, { message: 'O custo deve ser um valor numérico válido, com até duas casas decimais.' })
  @Min(0, { message: 'O custo não pode ser negativo.' })
  @Max(99_999_999.99, { message: 'O custo excede o limite máximo permitido.' })
  costPrice?: number;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsNumber({ maxDecimalPlaces: 3, allowNaN: false, allowInfinity: false }, { message: 'A quantidade deve ser numérica e ter até três casas decimais.' })
  @Min(0, { message: 'A quantidade em estoque não pode ser negativa neste campo.' })
  @Max(999_999_999.999, { message: 'A quantidade excede o limite máximo permitido.' })
  quantity?: number;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsNumber({ maxDecimalPlaces: 3, allowNaN: false, allowInfinity: false }, { message: 'O estoque mínimo deve ser numérico e ter até três casas decimais.' })
  @Min(0, { message: 'O estoque mínimo não pode ser negativo.' })
  @Max(999_999_999.999, { message: 'O estoque mínimo excede o limite máximo permitido.' })
  minQuantity?: number;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsDateString({}, { message: 'Informe uma data de validade válida.' })
  expiresAt?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean({ message: 'O controle de estoque deve ser verdadeiro ou falso.' })
  trackStock?: boolean;
}
