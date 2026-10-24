import { PartialType } from '@nestjs/mapped-types';
import { CreateSaleDto } from './create-sale.dto.js';

export class UpdateSaleDto extends PartialType(CreateSaleDto) {}
