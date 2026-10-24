import { PartialType } from '@nestjs/mapped-types';
import { CreateShiftDto } from './create-shift.dto.js';

export class UpdateShiftDto extends PartialType(CreateShiftDto) {}
