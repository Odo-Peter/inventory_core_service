export const IMAGE_STORAGE = Symbol('IMAGE_STORAGE');

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 24_000_000;

export const ALLOWED_IMAGE_FORMATS = ['jpeg', 'png', 'webp'] as const;

export type ImageVariant = 'thumb' | 'full';

export const IMAGE_VARIANTS = {
  thumb: {
    transformation: [
      {
        crop: 'fill',
        width: 160,
        height: 160,
        fetch_format: 'auto',
        quality: 'auto',
      },
    ],
  },
  full: {
    transformation: [
      { crop: 'limit', width: 800, fetch_format: 'auto', quality: 'auto' },
    ],
  },
} as const;
export interface ImageStorage {
  readonly enabled: boolean;
  upload(key: string, data: Buffer, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
  url(key: string, variant: ImageVariant): string;
}
