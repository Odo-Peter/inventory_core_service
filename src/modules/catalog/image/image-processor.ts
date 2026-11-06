import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

import { AppException } from '../../../common/errors/app.exception.js';
import {
  ALLOWED_IMAGE_FORMATS,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
} from './image-storage.js';

export interface UploadedImage {
  buffer?: Buffer;
  size?: number;
}

/**
 * Shared by item create (POST /items) and item image upload
 * (PUT /items/:id/image) so both paths validate and normalize identically
 * (ADR 0019). Throws 4xx AppExceptions and never touches storage or the DB.
 */
@Injectable()
export class ImageProcessor {
  async normalize(file: UploadedImage | undefined): Promise<Buffer> {
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
}

/** Maps a storage failure to the contract in ADR 0019 (503). */
export function toImageStorageError(error: unknown): AppException {
  if (error instanceof AppException) {
    return error; // e.g. 503 image_storage_not_configured from DisabledImageStorage
  }

  return new AppException(
    503,
    'image_storage_unavailable',
    'Image storage is unavailable',
  );
}
