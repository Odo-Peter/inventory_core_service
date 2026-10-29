import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception.js';
import {
  buildPageMeta,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  toSkipTake,
} from '../../common/pagination/pagination.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { ItemModel } from '../../generated/prisma/models.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AUDIT_ACTIONS } from '../audit/audit-actions.js';
import { AuditService } from '../audit/audit.service.js';
import type { Principal } from '../auth/principal.js';
import { normalizeDisplayText, normalizeOptionalText } from './catalog-text.js';
import { toItemResponse, toPriceHistoryResponse } from './item.mapper.js';
import type {
  ChangeItemPriceDto,
  CreateItemDto,
  ItemListResponseDto,
  ItemResponseDto,
  ListItemsQueryDto,
  PriceHistoryListResponseDto,
  UpdateItemDto,
} from './dto/item.dto.js';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import {
  ImageProcessor,
  toImageStorageError,
  UploadedImage,
} from './image/image-processor.js';
import { IMAGE_STORAGE, type ImageStorage } from './image/image-storage.js';
import { generateSku } from './sku-generator.js';

@Injectable()
export class ItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly imageProcessor: ImageProcessor,
    @Inject(IMAGE_STORAGE) private readonly storage: ImageStorage,
  ) {}

  async list(
    principal: Principal,
    query: ListItemsQueryDto,
  ): Promise<ItemListResponseDto> {
    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = query.page_size ?? DEFAULT_PAGE_SIZE;
    const where: Prisma.ItemWhereInput = {
      store_id: principal.store_id,
    };

    if (query.category_id) {
      where.category_id = query.category_id;
    }
    if (query.active !== undefined) {
      where.active = query.active;
    }
    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        { sku: { contains: query.q, mode: 'insensitive' } },
        { barcode: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    if (query.low_stock) {
      where.AND = [
        { reorder_threshold: { gt: 0 } },
        { stock_quantity: { lte: this.prisma.item.fields.reorder_threshold } },
      ];
    }

    const { skip, take } = toSkipTake(page, pageSize);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.item.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip,
        take,
      }),
      this.prisma.item.count({ where }),
    ]);

    return {
      data: items.map((item) => toItemResponse(item, principal.role)),
      meta: buildPageMeta(total, page, pageSize),
    };
  }

  async findOne(principal: Principal, id: string): Promise<ItemResponseDto> {
    return toItemResponse(
      await this.findScopedItem(principal, id),
      principal.role,
    );
  }

  async findByBarcode(
    principal: Principal,
    barcode: string,
  ): Promise<ItemResponseDto> {
    const normalized = barcode.trim();
    const item = await this.prisma.item.findFirst({
      where: { store_id: principal.store_id, barcode: normalized },
    });

    if (!item) {
      throw new AppException(404, 'item_not_found', 'Item not found');
    }

    return toItemResponse(item, principal.role);
  }

  async create(
    principal: Principal,
    dto: CreateItemDto,
    file?: UploadedImage,
  ): Promise<ItemResponseDto> {
    const barcode = normalizeOptionalText(dto.barcode);
    const categoryId = dto.category_id ?? null;

    // 1. Validate everything that can fail without side effects.
    const category = await this.assertCategory(principal.store_id, categoryId);
    if (barcode) {
      await this.assertBarcodeAvailable(principal.store_id, barcode);
    }
    const processed = file ? await this.imageProcessor.normalize(file) : null;
    const sku = await this.allocateSku(principal.store_id, category?.name);

    // 2. Generate the id up front so the storage key can contain it.
    const itemId = randomUUID();
    const imageKey = processed
      ? `items/${principal.store_id}/${itemId}/${randomUUID()}`
      : null;

    // 3. Store the image first. A failure here creates no item.
    if (processed && imageKey) {
      try {
        await this.storage.upload(imageKey, processed, 'image/webp');
      } catch (error: unknown) {
        throw toImageStorageError(error);
      }
    }

    // 4. One transaction: item (stock 0) + single audit entry.
    try {
      const item = await this.prisma.$transaction(async (tx) => {
        const created = await tx.item.create({
          data: {
            id: itemId,
            store_id: principal.store_id,
            sku,
            barcode,
            name: normalizeDisplayText(dto.name),
            category_id: categoryId,
            unit: dto.unit.trim(),
            current_price: dto.current_price,
            cost_price: dto.cost_price ?? null,
            reorder_threshold: dto.reorder_threshold ?? 0,
            active: dto.active ?? true,
            image_key: imageKey,
          },
        });

        await this.audit.record(
          {
            store_id: principal.store_id,
            staff_id: principal.staff_id,
            action: AUDIT_ACTIONS.itemCreated,
            entity_type: 'Item',
            entity_id: created.id,
            details: {
              sku: created.sku,
              name: created.name,
              current_price: created.current_price,
              reorder_threshold: created.reorder_threshold,
              has_image: imageKey !== null,
            },
          },
          tx,
        );

        return created;
      });

      return toItemResponse(item, principal.role);
    } catch (error: unknown) {
      // 5. Compensate; a failed delete never masks the original error.
      if (imageKey) {
        await this.removeQuietly(imageKey);
      }
      this.rethrowDuplicate(error);
      throw error;
    }
  }

  async update(
    principal: Principal,
    id: string,
    dto: UpdateItemDto,
  ): Promise<ItemResponseDto> {
    const existing = await this.findScopedItem(principal, id);
    const data: Prisma.ItemUncheckedUpdateInput = {};
    const changed: string[] = [];

    if (dto.sku !== undefined) {
      const sku = dto.sku.trim();
      if (sku !== existing.sku) {
        await this.assertSkuAvailable(principal.store_id, sku, id);
      }
      data.sku = sku;
      changed.push('sku');
    }

    if (dto.barcode !== undefined) {
      const barcode = normalizeOptionalText(dto.barcode);
      if (barcode !== existing.barcode) {
        if (barcode) {
          await this.assertBarcodeAvailable(principal.store_id, barcode, id);
        }
      }
      data.barcode = barcode;
      changed.push('barcode');
    }

    if (dto.name !== undefined) {
      data.name = normalizeDisplayText(dto.name);
      changed.push('name');
    }

    if (dto.category_id !== undefined) {
      const categoryId = dto.category_id ?? null;
      if (categoryId !== existing.category_id) {
        await this.assertCategory(principal.store_id, categoryId);
      }
      data.category_id = categoryId;
      changed.push('category_id');
    }

    if (dto.unit !== undefined) {
      data.unit = dto.unit.trim();
      changed.push('unit');
    }

    if (dto.cost_price !== undefined) {
      data.cost_price = dto.cost_price;
      changed.push('cost_price');
    }

    if (dto.reorder_threshold !== undefined) {
      data.reorder_threshold = dto.reorder_threshold;
      changed.push('reorder_threshold');
    }

    if (dto.active !== undefined && dto.active !== existing.active) {
      if (principal.role !== 'admin') {
        throw new AppException(
          403,
          'forbidden',
          'Only admins can activate or deactivate items',
        );
      }
      data.active = dto.active;
      changed.push('active');
    }

    if (changed.length === 0) {
      return toItemResponse(existing, principal.role);
    }

    try {
      const item = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.item.update({
          where: { id: existing.id },
          data,
        });

        await this.audit.record(
          {
            store_id: principal.store_id,
            staff_id: principal.staff_id,
            action: AUDIT_ACTIONS.itemUpdated,
            entity_type: 'Item',
            entity_id: updated.id,
            details: { fields: changed },
          },
          tx,
        );

        return updated;
      });

      return toItemResponse(item, principal.role);
    } catch (error: unknown) {
      this.rethrowDuplicate(error);
      throw error;
    }
  }

  async deactivate(principal: Principal, id: string): Promise<ItemResponseDto> {
    const existing = await this.findScopedItem(principal, id);

    if (!existing.active) {
      return toItemResponse(existing, principal.role);
    }

    const item = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.item.update({
        where: { id: existing.id },
        data: { active: false },
      });

      await this.audit.record(
        {
          store_id: principal.store_id,
          staff_id: principal.staff_id,
          action: AUDIT_ACTIONS.itemDeactivated,
          entity_type: 'Item',
          entity_id: updated.id,
          details: { active: false },
        },
        tx,
      );

      return updated;
    });

    return toItemResponse(item, principal.role);
  }

  async changePrice(
    principal: Principal,
    id: string,
    dto: ChangeItemPriceDto,
  ): Promise<ItemResponseDto> {
    const item = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.item.findFirst({
        where: { id, store_id: principal.store_id },
      });

      if (!existing) {
        throw new AppException(404, 'item_not_found', 'Item not found');
      }

      if (existing.current_price === dto.new_price) {
        return existing;
      }

      const updated = await tx.item.update({
        where: { id: existing.id },
        data: { current_price: dto.new_price },
      });

      await tx.priceHistory.create({
        data: {
          item_id: existing.id,
          old_price: existing.current_price,
          new_price: dto.new_price,
          changed_by_staff_id: principal.staff_id,
        },
      });

      await this.audit.record(
        {
          store_id: principal.store_id,
          staff_id: principal.staff_id,
          action: AUDIT_ACTIONS.itemPriceChanged,
          entity_type: 'Item',
          entity_id: existing.id,
          details: {
            old_price: existing.current_price,
            new_price: dto.new_price,
          },
        },
        tx,
      );

      return updated;
    });

    return toItemResponse(item, principal.role);
  }

  async listPriceHistory(
    principal: Principal,
    id: string,
    query: PaginationQueryDto,
  ): Promise<PriceHistoryListResponseDto> {
    await this.findScopedItem(principal, id);
    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = query.page_size ?? DEFAULT_PAGE_SIZE;
    const where: Prisma.PriceHistoryWhereInput = { item_id: id };
    const { skip, take } = toSkipTake(page, pageSize);

    const [entries, total] = await this.prisma.$transaction([
      this.prisma.priceHistory.findMany({
        where,
        orderBy: [{ changed_at: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.priceHistory.count({ where }),
    ]);

    return {
      data: entries.map(toPriceHistoryResponse),
      meta: buildPageMeta(total, page, pageSize),
    };
  }

  private async findScopedItem(
    principal: Principal,
    id: string,
  ): Promise<ItemModel> {
    const item = await this.prisma.item.findFirst({
      where: { id, store_id: principal.store_id },
    });

    if (!item) {
      throw new AppException(404, 'item_not_found', 'Item not found');
    }

    return item;
  }

  private async assertCategory(
    storeId: string,
    categoryId: string | null,
  ): Promise<{ id: string; name: string } | null> {
    if (!categoryId) {
      return null;
    }

    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, store_id: storeId },
      select: { id: true, name: true },
    });

    if (!category) {
      throw new AppException(404, 'category_not_found', 'Category not found');
    }

    return category;
  }

  private async assertSkuAvailable(
    storeId: string,
    sku: string,
    excludeId?: string,
  ): Promise<void> {
    const duplicate = await this.prisma.item.findFirst({
      where: {
        store_id: storeId,
        sku,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });

    if (duplicate) {
      throw new AppException(
        409,
        'duplicate_sku',
        'An item with this SKU already exists',
      );
    }
  }

  private async assertBarcodeAvailable(
    storeId: string,
    barcode: string,
    excludeId?: string,
  ): Promise<void> {
    const duplicate = await this.prisma.item.findFirst({
      where: {
        store_id: storeId,
        barcode,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });

    if (duplicate) {
      throw new AppException(
        409,
        'duplicate_barcode',
        'An item with this barcode already exists',
      );
    }
  }

  private rethrowDuplicate(error: unknown): void {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      (error as { code: unknown }).code !== 'P2002'
    ) {
      return;
    }

    const target = JSON.stringify(
      (error as { meta?: { target?: unknown } }).meta?.target ?? '',
    );

    if (target.toLowerCase().includes('barcode')) {
      throw new AppException(
        409,
        'duplicate_barcode',
        'An item with this barcode already exists',
      );
    }

    throw new AppException(
      409,
      'duplicate_sku',
      'An item with this SKU already exists',
    );
  }

  private async removeQuietly(key: string): Promise<void> {
    try {
      await this.storage.remove(key);
    } catch {
      // Best effort: the database is authoritative and a stale object is safe.
    }
  }

  private async allocateSku(
    storeId: string,
    categoryName: string | null | undefined,
  ): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = generateSku(categoryName);
      const existing = await this.prisma.item.findFirst({
        where: { store_id: storeId, sku: candidate },
        select: { id: true },
      });
      if (!existing) {
        return candidate;
      }
    }

    throw new AppException(
      500,
      'sku_generation_failed',
      'Could not generate a unique SKU, please retry',
    );
  }
}
