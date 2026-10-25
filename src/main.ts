import { NestFactory } from '@nestjs/core';
import { config as loadDotenv } from 'dotenv';

import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { APP_CONFIG, type AppConfig } from './config/app-config.js';

loadDotenv();

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const config = app.get<AppConfig>(APP_CONFIG);
  configureApp(app, config);

  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
}

bootstrap().catch((error: unknown) => {
  console.error('Application bootstrap failed', error);
  process.exitCode = 1;
});
