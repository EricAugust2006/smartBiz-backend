import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsNotEmpty, IsNumber, IsOptional,
  IsString, IsUUID, Matches, Max, Min, ValidateIf, ValidateNested,
} from 'class-validator';
import { normalizePhone, PHONE_PATTERN } from '../../customers/customer-identifiers';

export class SaleItemDto {
  @IsOptional()
  @IsUUID(undefined, { message: 'O identificador do produto é inválido.' })
  productId?: string;

  @ValidateIf((item: SaleItemDto) => item.productId === undefined)
  @IsString({ message: 'O nome do item avulso deve ser um texto.' })
  @IsNotEmpty({ message: 'Informe o nome do item avulso.' })
  name?: string;

  @IsNumber({ maxDecimalPlaces: 3, allowNaN: false, allowInfinity: false }, { message: 'A quantidade deve ser numérica e ter até três casas decimais.' })
  @Min(0.001, { message: 'A quantidade deve ser maior que zero.' })
  @Max(1_000_000, { message: 'A quantidade excede o limite máximo permitido.' })
  quantity: number;

  @ValidateIf((item: SaleItemDto) => item.productId === undefined)
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false }, { message: 'O preço unitário do item avulso deve ser numérico e ter até duas casas decimais.' })
  @Min(0, { message: 'O preço unitário não pode ser negativo.' })
  @Max(9_999_999_999.99, { message: 'O preço unitário excede o limite máximo permitido.' })
  unitPrice?: number;
}

export class CreateSaleDto {
  @IsUUID('4', { message: 'A chave da venda é inválida.' })
  idempotencyKey: string;

  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false }, { message: 'O valor da venda deve ser um valor numérico válido, com até duas casas decimais.' })
  @Min(0.01, { message: 'O valor da venda deve ser maior que zero.' })
  @Max(9_999_999_999.99, { message: 'O valor da venda excede o limite máximo permitido.' })
  amount: number;

  @IsOptional()
  @IsArray({ message: 'Os itens da venda devem ser informados em uma lista.' })
  @ArrayMinSize(1, { message: 'A venda deve conter pelo menos um item.' })
  @ArrayMaxSize(100, { message: 'A venda não pode conter mais de 100 itens.' })
  @ValidateNested({ each: true, message: 'Um ou mais itens da venda contêm dados inválidos.' })
  @Type(() => SaleItemDto)
  items?: SaleItemDto[];

  @IsOptional()
  @IsUUID(undefined, { message: 'O identificador do cliente é inválido.' })
  customerId?: string;

  @IsOptional()
  @Transform(({ value }) => normalizePhone(value))
  @IsString({ message: 'O telefone do cliente deve ser informado como texto.' })
  @Matches(PHONE_PATTERN, { message: 'Informe um telefone válido para o cliente, com DDD.' })
  customerPhone?: string;
}
