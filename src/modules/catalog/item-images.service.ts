import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import sharp from 'sharp';

import { AppException } from '../../common/errors/app.exception.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { ItemModel } from '../../generated/prisma/models.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AUDIT_ACTIONS } from '../audit/audit-actions.js';
import { AuditService } from '../audit/audit.service.js';
import type { Principal } from '../auth/principal.js';
import type { ItemImageResponseDto } from './dto/item-image.dto.js';
import {
  ALLOWED_IMAGE_FORMATS,
  IMAGE_STORAGE,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  type ImageStorage,
} from './image/image-storage.js';

interface UploadedImage {
  buffer?: Buffer;
  size?: number;
}

@Injectable()
export class ItemImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(IMAGE_STORAGE) private readonly storage: ImageStorage,
  ) {}

  async upload(
    principal: Principal,
    itemId: string,
    file: UploadedImage | undefined,
  ): Promise<ItemImageResponseDto> {
    const item = await this.findScopedItem(principal, itemId);
    const processed = await this.process(file);
    const key = `items/${principal.store_id}/${item.id}/${randomUUID()}`;

    try {
      await this.storage.upload(key, processed, 'image/webp');
    } catch (error: unknown) {
      throw this.toStorageError(error);
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.replaceKey(tx, principal, item, key);
      });
    } catch (error: unknown) {
      await this.removeQuietly(key);
      throw error;
    }

    if (item.image_key) {
      await this.removeQuietly(item.image_key);
    }

    return this.toResponse(item.id, key);
  }

  async remove(
    principal: Principal,
    itemId: string,
  ): Promise<ItemImageResponseDto> {
    const item = await this.findScopedItem(principal, itemId);

    if (!item.image_key) {
      return this.toResponse(item.id, null);
    }

    const previousKey = item.image_key;

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.item.updateMany({
        where: {
          id: item.id,
          store_id: principal.store_id,
          image_key: previousKey,
        },
        data: { image_key: null },
      });

      if (updated.count !== 1) {
        throw new AppException(
          409,
          'image_changed',
          'The item image changed during this request',
        );
      }

      await this.audit.record(
        {
          store_id: principal.store_id,
          staff_id: principal.staff_id,
          action: AUDIT_ACTIONS.itemImageRemoved,
          entity_type: 'Item',
          entity_id: item.id,
          details: { previous_image_key: previousKey },
        },
        tx,
      );
    });

    await this.removeQuietly(previousKey);

    return this.toResponse(item.id, null);
  }

  private async replaceKey(
    tx: Prisma.TransactionClient,
    principal: Principal,
    item: ItemModel,
    key: string,
  ): Promise<void> {
    const updated = await tx.item.updateMany({
      where: {
        id: item.id,
        store_id: principal.store_id,
        image_key: item.image_key,
      },
      data: { image_key: key },
    });

    if (updated.count !== 1) {
      throw new AppException(
        409,
        'image_changed',
        'The item image changed during this request',
      );
    }

    await this.audit.record(
      {
        store_id: principal.store_id,
        staff_id: principal.staff_id,
        action: AUDIT_ACTIONS.itemImageUpdated,
        entity_type: 'Item',
        entity_id: item.id,
        details: {
          image_key: key,
          previous_image_key: item.image_key,
        },
      },
      tx,
    );
  }

  private async findScopedItem(
    principal: Principal,
    itemId: string,
  ): Promise<ItemModel> {
    const item = await this.prisma.item.findFirst({
      where: { id: itemId, store_id: principal.store_id },
    });

    if (!item) {
      throw new AppException(404, 'item_not_found', 'Item not found');
    }

    return item;
  }

  private async process(file: UploadedImage | undefined): Promise<Buffer> {
    if (!file?.buffer || file.buffer.length === 0) {
      throw new AppException(
        400,
        'image_required',
        'An image file is required',
      );
    }

    const declaredSize = file.size ?? file.buffer.length;
    if (declaredSize > MAX_IMAGE_BYTES) {
      throw new AppException(
        413,
        'image_too_large',
        'Image must be 2 MB or smaller',
      );
    }

    const limits = {
      limitInputPixels: MAX_IMAGE_PIXELS,
      failOn: 'error' as const,
    };

    let format: string | undefined;
    let pages: number | undefined;
    try {
      const metadata = await sharp(file.buffer, limits).metadata();
      format = metadata.format;
      pages = metadata.pages;
    } catch {
      throw new AppException(400, 'invalid_image', 'Invalid image file');
    }

    if (
      !format ||
      !ALLOWED_IMAGE_FORMATS.includes(
        format as (typeof ALLOWED_IMAGE_FORMATS)[number],
      )
    ) {
      throw new AppException(
        400,
        'unsupported_image_type',
        'Image must be JPEG, PNG, or WebP',
      );
    }

    if ((pages ?? 1) > 1) {
      throw new AppException(
        400,
        'unsupported_image_type',
        'Animated images are not supported',
      );
    }

    try {
      return await sharp(file.buffer, limits)
        .rotate()
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      throw new AppException(400, 'invalid_image', 'Invalid image file');
    }
  }

  private toResponse(itemId: string, key: string | null): ItemImageResponseDto {
    if (!key || !this.storage.enabled) {
      return { item_id: itemId, image_key: key, variants: null };
    }

    return {
      item_id: itemId,
      image_key: key,
      variants: {
        thumb: this.storage.url(key, 'thumb'),
        full: this.storage.url(key, 'full'),
      },
    };
  }

  private toStorageError(error: unknown): AppException {
    if (error instanceof AppException) {
      return error;
    }

    return new AppException(
      502,
      'image_storage_error',
      'Image storage could not store the image',
    );
  }

  private async removeQuietly(key: string): Promise<void> {
    try {
      await this.storage.remove(key);
    } catch {
      // Best effort: the database is authoritative and a stale object is safe.
    }
  }
}
