import { v2 as cloudinary } from 'cloudinary';

import type { ImageStorageConfig } from '../../../config/app-config.js';
import {
  IMAGE_VARIANTS,
  type ImageStorage,
  type ImageVariant,
} from './image-storage.js';

export class CloudinaryImageStorage implements ImageStorage {
  readonly enabled = true;

  constructor(config: ImageStorageConfig) {
    cloudinary.config({
      cloud_name: config.cloudName,
      api_key: config.apiKey,
      api_secret: config.apiSecret,
      secure: true,
    });
  }

  upload(key: string, data: Buffer, _contentType: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          public_id: key,
          overwrite: true,
          invalidate: true,
          resource_type: 'image',
        },
        (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        },
      );

      stream.end(data);
    });
  }

  async remove(key: string): Promise<void> {
    await cloudinary.uploader.destroy(key, { invalidate: true });
  }

  url(key: string, variant: ImageVariant): string {
    return cloudinary.url(key, {
      secure: true,
      transformation: IMAGE_VARIANTS[variant].transformation,
    });
  }
}
