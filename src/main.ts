import { randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';

import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  // Use the configured Pino logger for NestJS framework logs.
  app.useLogger(app.get(Logger));

  // Apply standard HTTP security headers.
  app.use(helmet());

  // All public API endpoints use the versioned REST prefix.
  app.setGlobalPrefix('api/v1');

  // Allow only explicitly configured frontend origins.
  const isProduction = process.env.NODE_ENV === 'production';
  const corsOrigins = (
    process.env.CORS_ORIGINS ?? (isProduction ? '' : 'http://localhost:5173')
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (isProduction && corsOrigins.length === 0) {
    throw new Error('CORS_ORIGINS must be configured in production');
  }

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    exposedHeaders: ['X-Request-ID'],
  });

  // Validate incoming DTOs consistently across controllers.
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    }),
  );

  // Allow NestJS providers to clean up resources on shutdown.
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid TCP port');
  }

  await app.listen(port, '0.0.0.0');
}

bootstrap().catch((error: unknown) => {
  // Pino is configured by AppModule; use it if initialization succeeded.
  // Bootstrap failures before logger setup still need a visible error.
  console.error('Application bootstrap failed', error);
  process.exitCode = 1;
});
