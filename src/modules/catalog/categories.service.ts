import { Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception.js';
import {
  buildPageMeta,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  toSkipTake,
} from '../../common/pagination/pagination.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AUDIT_ACTIONS } from '../audit/audit-actions.js';
import { AuditService } from '../audit/audit.service.js';
import type { Principal } from '../auth/principal.js';
import { normalizeDisplayText } from './catalog-text.js';
import { toCategoryResponse } from './category.mapper.js';
import type {
  CategoryListResponseDto,
  CategoryResponseDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from './dto/category.dto.js';
import type { ListCategoriesQueryDto } from './dto/catalog-query.dto.js';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    principal: Principal,
    query: ListCategoriesQueryDto,
  ): Promise<CategoryListResponseDto> {
    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = query.page_size ?? DEFAULT_PAGE_SIZE;
    const where: Prisma.CategoryWhereInput = {
      store_id: principal.store_id,
    };

    if (query.active !== undefined) {
      where.active = query.active;
    }
    if (query.q) {
      where.name = { contains: query.q, mode: 'insensitive' };
    }

    const { skip, take } = toSkipTake(page, pageSize);
    const [categories, total] = await this.prisma.$transaction([
      this.prisma.category.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip,
        take,
      }),
      this.prisma.category.count({ where }),
    ]);

    return {
      data: categories.map(toCategoryResponse),
      meta: buildPageMeta(total, page, pageSize),
    };
  }

  async findOne(
    principal: Principal,
    id: string,
  ): Promise<CategoryResponseDto> {
    const category = await this.prisma.category.findFirst({
      where: { id, store_id: principal.store_id },
    });

    if (!category) {
      throw new AppException(404, 'category_not_found', 'Category not found');
    }

    return toCategoryResponse(category);
  }

  async create(
    principal: Principal,
    dto: CreateCategoryDto,
  ): Promise<CategoryResponseDto> {
    const name = normalizeDisplayText(dto.name);
    await this.assertNameAvailable(principal.store_id, name);

    try {
      const category = await this.prisma.$transaction(async (tx) => {
        const created = await tx.category.create({
          data: {
            store_id: principal.store_id,
            name,
            active: dto.active ?? true,
          },
        });

        await this.audit.record(
          {
            store_id: principal.store_id,
            staff_id: principal.staff_id,
            action: AUDIT_ACTIONS.categoryCreated,
            entity_type: 'Category',
            entity_id: created.id,
            details: { name: created.name, active: created.active },
          },
          tx,
        );

        return created;
      });

      return toCategoryResponse(category);
    } catch (error: unknown) {
      this.rethrowDuplicate(error);
      throw error;
    }
  }

  async update(
    principal: Principal,
    id: string,
    dto: UpdateCategoryDto,
  ): Promise<CategoryResponseDto> {
    const existing = await this.prisma.category.findFirst({
      where: { id, store_id: principal.store_id },
    });

    if (!existing) {
      throw new AppException(404, 'category_not_found', 'Category not found');
    }

    const name =
      dto.name !== undefined ? normalizeDisplayText(dto.name) : undefined;

    if (name !== undefined && name !== existing.name) {
      await this.assertNameAvailable(principal.store_id, name, id);
    }

    const data: Prisma.CategoryUpdateInput = {};
    if (name !== undefined) {
      data.name = name;
    }
    if (dto.active !== undefined) {
      data.active = dto.active;
    }

    if (Object.keys(data).length === 0) {
      return toCategoryResponse(existing);
    }

    try {
      const category = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.category.update({
          where: { id: existing.id },
          data,
        });

        await this.audit.record(
          {
            store_id: principal.store_id,
            staff_id: principal.staff_id,
            action: AUDIT_ACTIONS.categoryUpdated,
            entity_type: 'Category',
            entity_id: updated.id,
            details: {
              fields: Object.keys(data),
              name: updated.name,
              active: updated.active,
            },
          },
          tx,
        );

        return updated;
      });

      return toCategoryResponse(category);
    } catch (error: unknown) {
      this.rethrowDuplicate(error);
      throw error;
    }
  }

  private async assertNameAvailable(
    storeId: string,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const duplicate = await this.prisma.category.findFirst({
      where: {
        store_id: storeId,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });

    if (duplicate) {
      throw new AppException(
        409,
        'category_name_taken',
        'A category with this name already exists',
      );
    }
  }

  private rethrowDuplicate(error: unknown): void {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: unknown }).code === 'P2002'
    ) {
      throw new AppException(
        409,
        'category_name_taken',
        'A category with this name already exists',
      );
    }
  }
}
