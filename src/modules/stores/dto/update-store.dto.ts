import { PartialType } from '@nestjs/mapped-types';
import { CreateStoreDto } from './create-store.dto.js';

export class UpdateStoreDto extends PartialType(CreateStoreDto) {}
