import { PartialType } from '@nestjs/mapped-types';
import { CreateAuditDto } from './create-audit.dto.js';

export class UpdateAuditDto extends PartialType(CreateAuditDto) {}
