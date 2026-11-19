import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class FindProductsDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString({ message: 'O nome para busca deve ser um texto.' })
  @MaxLength(120, { message: 'O nome para busca deve ter no máximo 120 caracteres.' })
  name?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString({ message: 'A categoria para busca deve ser um texto.' })
  @MaxLength(120, { message: 'A categoria para busca deve ter no máximo 120 caracteres.' })
  category?: string;
}
