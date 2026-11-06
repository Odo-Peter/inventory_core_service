import type { ImageStorageConfig } from '../../../config/app-config.js';
import { CloudinaryImageStorage } from './cloudinary-image-storage.js';
import { DisabledImageStorage } from './disabled-image-storage.js';
import type { ImageStorage } from './image-storage.js';

export function createImageStorage(config: ImageStorageConfig): ImageStorage {
  if (config.driver === 'cloudinary') {
    return new CloudinaryImageStorage(config);
  }

  return new DisabledImageStorage();
}
