import { GoalType } from '@prisma/client';
import { ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

@ValidatorConstraint({ name: 'visitsTarget', async: false })
export class VisitsTargetValidator implements ValidatorConstraintInterface {
  validate(value: unknown, arguments_?: ValidationArguments): boolean {
    if (!arguments_ || !('goalType' in arguments_.object)) return false;
    if (arguments_.object.goalType !== GoalType.VISITS) return true;
    return typeof value === 'number' && Number.isInteger(value);
  }

  defaultMessage(): string {
    return 'targetValue must be a positive integer for VISITS missions.';
  }
}
