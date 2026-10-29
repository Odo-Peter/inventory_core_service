import { Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { AuditModule } from '../audit/audit.module.js';
import { CategoriesController } from './categories.controller.js';
import { CategoriesService } from './categories.service.js';
import { ItemImagesController } from './item-images.controller.js';
import { ItemImagesService } from './item-images.service.js';
import { ItemsController } from './items.controller.js';
import { ItemsService } from './items.service.js';
import { IMAGE_STORAGE } from './image/image-storage.js';
import { createImageStorage } from './image/image-storage.provider.js';

@Module({
  imports: [AuditModule],
  controllers: [CategoriesController, ItemsController, ItemImagesController],
  providers: [
    CategoriesService,
    ItemsService,
    ItemImagesService,
    {
      provide: IMAGE_STORAGE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createImageStorage(config.imageStorage),
    },
  ],
})
export class CatalogModule {}
