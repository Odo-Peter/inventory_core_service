import { AppException } from '../../../common/errors/app.exception.js';
import type { ImageStorage, ImageVariant } from './image-storage.js';

export class DisabledImageStorage implements ImageStorage {
  readonly enabled = false;

  upload(): Promise<void> {
    return Promise.reject(
      new AppException(
        503,
        'image_storage_disabled',
        'Image storage is not configured',
      ),
    );
  }

  remove(): Promise<void> {
    return Promise.reject(
      new AppException(
        503,
        'image_storage_disabled',
        'Image storage is not configured',
      ),
    );
  }

  url(_key: string, _variant: ImageVariant): string {
    throw new AppException(
      503,
      'image_storage_disabled',
      'Image storage is not configured',
    );
  }
}
