import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { StoresModule } from './modules/stores/stores.module.js';
import { DevicesModule } from './modules/devices/devices.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { InventoryModule } from './modules/inventory/inventory.module.js';
import { SalesModule } from './modules/sales/sales.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { ShiftsModule } from './modules/shifts/shifts.module.js';

const isProduction = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),

        genReqId: (req, res) => {
          const incoming = req.headers['x-request-id'];

          const requestId =
            typeof incoming === 'string' &&
            /^[a-zA-Z0-9._-]{1,128}$/.test(incoming)
              ? incoming
              : crypto.randomUUID();

          res.setHeader('x-request-id', requestId);
          return requestId;
        },

        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
            'req.body.password',
            'req.body.pin',
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
    DevicesModule,
    AuditModule,
    InventoryModule,
    SalesModule,
    PaymentsModule,
    ShiftsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
