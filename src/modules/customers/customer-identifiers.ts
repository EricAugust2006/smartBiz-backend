import { ValidateBy, ValidationOptions } from 'class-validator';

export const PHONE_PATTERN = /^\+[1-9]\d{9,14}$/;

// Accept Brazilian national numbers and international numbers with a country code.
export function normalizePhone(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const phone = value.trim().replace(/[\s().-]/g, '');
  if (/^\d{10,11}$/.test(phone)) return `+55${phone}`;
  if (/^55\d{10,11}$/.test(phone)) return `+${phone}`;
  return phone;
}

export function normalizeCpf(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().replace(/[.\-]/g, '') : value;
}

export function isValidCpf(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) {
    return false;
  }
  for (let length = 9; length <= 10; length++) {
    let sum = 0;
    for (let index = 0; index < length; index++) {
      sum += Number(value[index]) * (length + 1 - index);
    }
    const digit = (sum * 10) % 11;
    if ((digit === 10 ? 0 : digit) !== Number(value[length])) return false;
  }
  return true;
}

export function IsCpf(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy({
    name: 'isCpf',
    validator: {
      validate: isValidCpf,
      defaultMessage: () => 'cpf must be a valid CPF.',
    },
  }, options);
}
