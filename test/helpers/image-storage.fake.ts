import type {
  ImageStorage,
  ImageVariant,
} from '../../src/modules/catalog/image/image-storage.js';

interface StoredObject {
  data: Buffer;
  contentType: string;
}

export class MemoryImageStorage implements ImageStorage {
  readonly enabled = true;
  readonly objects = new Map<string, StoredObject>();
  readonly uploads: string[] = [];
  readonly removals: string[] = [];
  failNextUpload = false;
  failNextRemove = false;

  upload(key: string, data: Buffer, contentType: string): Promise<void> {
    if (this.failNextUpload) {
      this.failNextUpload = false;
      return Promise.reject(new Error('simulated upload failure'));
    }

    this.uploads.push(key);
    this.objects.set(key, { data: Buffer.from(data), contentType });
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    this.removals.push(key);
    if (this.failNextRemove) {
      this.failNextRemove = false;
      return Promise.reject(new Error('simulated remove failure'));
    }

    this.objects.delete(key);
    return Promise.resolve();
  }

  url(key: string, variant: ImageVariant): string {
    return `https://images.test/${variant}/${key}`;
  }
}
