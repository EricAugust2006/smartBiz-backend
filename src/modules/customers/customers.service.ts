import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { requireTenant } from '../../common/utils/require-tenant';
import { PrismaService } from '../../database/prisma.service';
import { isValidCpf, normalizeCpf, normalizePhone, PHONE_PATTERN } from './customer-identifiers';
import { CreateCustomerDto } from './dto/create-customer.dto';

type CustomerReader = Pick<Prisma.TransactionClient, 'customer'>;

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateCustomerDto) {
    requireTenant(tenantId);
    const phone = this.phone(dto.phone);
    const cpf = dto.cpf == null ? undefined : normalizeCpf(dto.cpf);
    if (cpf !== undefined && !isValidCpf(cpf)) {
      throw new BadRequestException('Invalid CPF.');
    }

    try {
      return await this.prisma.customer.create({
        data: { tenantId, name: dto.name.trim(), phone, cpf: cpf as string | undefined },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Phone or CPF is already registered at this establishment.');
      }
      throw error;
    }
  }

  async findByPhone(tenantId: string, phone: string, database: CustomerReader = this.prisma) {
    requireTenant(tenantId);
    const customer = await database.customer.findFirst({
      where: { tenantId, phone: this.phone(phone) },
    });
    if (!customer) throw new NotFoundException('Customer not found.');
    return customer;
  }

  async findById(tenantId: string, id: string, database: CustomerReader = this.prisma) {
    requireTenant(tenantId);
    if (!id) throw new BadRequestException('A customer ID is required.');
    const customer = await database.customer.findFirst({ where: { tenantId, id } });
    if (!customer) throw new NotFoundException('Customer not found.');
    return customer;
  }

  private phone(value: string): string {
    const phone = normalizePhone(value);
    if (typeof phone !== 'string' || !PHONE_PATTERN.test(phone)) {
      throw new BadRequestException('Invalid phone number.');
    }
    return phone;
  }
}
