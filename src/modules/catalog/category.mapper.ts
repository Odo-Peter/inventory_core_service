import type { CategoryModel } from '../../generated/prisma/models.js';
import type { CategoryResponseDto } from './dto/category.dto.js';

export function toCategoryResponse(
  category: CategoryModel,
): CategoryResponseDto {
  return {
    id: category.id,
    store_id: category.store_id,
    name: category.name,
    active: category.active,
    created_at: category.created_at,
    updated_at: category.updated_at,
  };
}
