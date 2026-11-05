import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsNumber, IsOptional,
  IsString, IsUUID, Matches, Max, Min, ValidateNested,
} from 'class-validator';
import { normalizePhone, PHONE_PATTERN } from '../../customers/customer-identifiers';

export class SaleItemDto {
  @IsUUID()
  productId: string;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity: number;

  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(9_999_999_999.99)
  unitPrice: number;
}

export class CreateSaleDto {
  @IsUUID('4')
  idempotencyKey: string;

  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0.01)
  @Max(9_999_999_999.99)
  amount: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SaleItemDto)
  items?: SaleItemDto[];

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @Transform(({ value }) => normalizePhone(value))
  @IsString()
  @Matches(PHONE_PATTERN)
  customerPhone?: string;
}
