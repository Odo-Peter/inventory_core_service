import {
  ValidationPipe,
  VersioningType,
  type INestApplication,
  type ValidationPipeOptions,
} from '@nestjs/common';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import type { AppConfig } from './config/app-config.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';

export const VALIDATION_PIPE_OPTIONS: ValidationPipeOptions = {
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  forbidUnknownValues: true,
};

export function configureApp(app: INestApplication, config: AppConfig): void {
  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.setGlobalPrefix('api', {
    exclude: ['health', 'health/(.*)'],
  });
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });
  app.enableCors({
    origin: config.corsOrigins,
    credentials: false,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    exposedHeaders: ['X-Request-ID', 'Retry-After'],
  });
  app.useGlobalPipes(new ValidationPipe(VALIDATION_PIPE_OPTIONS));
  app.useGlobalFilters(new AllExceptionsFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Stocktake store Inventory & POS API')
    .setDescription(
      'stocktake store-scoped inventory and point-of-sale API for the single-store pilot.',
    )
    .setVersion('1.0')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    })
    .build();

  SwaggerModule.setup(
    'docs',
    app,
    () => SwaggerModule.createDocument(app, swaggerConfig),
    { jsonDocumentUrl: 'docs-json' },
  );
}
