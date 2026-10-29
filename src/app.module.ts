import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AppConfigModule } from './config/app-config.module.js';
import { CommonModule } from './common/common.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { StoresModule } from './modules/stores/stores.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { ShiftsModule } from './modules/shifts/shifts.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { InventoryModule } from './modules/inventory/inventory.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';

const isProduction = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    AppConfigModule,
    CommonModule,
    PrismaModule,
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),

        // Make status codes stand out
        customLogLevel: (req, res, err) => {
          if (res.statusCode >= 500 || err) {
            return 'error';
          }
          if (res.statusCode >= 400) {
            return 'warn';
          }
          return 'info';
        },

        // Clearer log messages
        customSuccessMessage: (req, res) => {
          return `${req.method} ${req.url} → ${res.statusCode}`;
        },
        customErrorMessage: (req, res, err) => {
          return `${req.method} ${req.url} → ${res.statusCode}${err?.message ? ` ${err.message}` : ''}`;
        },

        genReqId: (req, res) => {
          const incoming = req.headers['x-request-id'];

          const requestId =
            typeof incoming === 'string' &&
            /^[a-zA-Z0-9._-]{1,128}$/.test(incoming)
              ? incoming
              : randomUUID();

          res.setHeader('X-Request-ID', requestId);

          return requestId;
        },

        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
            'req.body.password',
            'req.body.pin',
            'req.body.current_pin',
            'req.body.new_pin',
            'req.body.acting_pin',
            'res.body.temporary_pin',
            'req.body.refreshToken',
            'req.body.accessToken',
            'req.body.token',
          ],
          censor: '[REDACTED]',
        },

        serializers: {
          req: (req) => ({
            id: req.id,
            method: req.method,
            url: req.url?.split('?')[0],
            remoteAddress: req.remoteAddress,
          }),
        },

        // Optional: skip noisy health checks
        autoLogging: {
          ignore: (req) =>
            req.url === '/health' || req.url?.startsWith('/health') === true,
        },

        ...(!isProduction
          ? {
              transport: {
                target: 'pino-pretty',
                options: {
                  colorize: true,
                  singleLine: true,
                  translateTime: 'SYS:standard',
                },
              },
            }
          : {}),
      },
    }),
    HealthModule,
    AuthModule,
    UsersModule,
    StoresModule,
    AuditModule,
    ShiftsModule,
    CatalogModule,
    InventoryModule,
    PaymentsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
