import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';

import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthGuard } from './guards/auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { PinAttemptService } from './pin-attempt.service.js';
import { PinHasherService } from './pin-hasher.service.js';
import { PinPolicy } from './pin-policy.js';
import { TokenService } from './token.service.js';

function staffCodeTracker(request: Record<string, unknown>): string {
  const body = request.body;
  if (typeof body === 'object' && body !== null) {
    const staffCode = (body as Record<string, unknown>).staff_code;
    if (typeof staffCode === 'string') {
      return `staff_code:${staffCode}`;
    }
  }
  return 'staff_code:unknown';
}

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.jwtSecret,
        signOptions: { algorithm: 'HS256' },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        throttlers: [
          {
            name: 'ip',
            limit: config.loginThrottleIpPerMin,
            ttl: 60_000,
          },
          {
            name: 'code',
            limit: config.loginThrottleCodePerMin,
            ttl: 60_000,
            getTracker: staffCodeTracker,
          },
        ],
      }),
    }),
    AuditModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    PinHasherService,
    PinAttemptService,
    PinPolicy,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [PinHasherService, PinPolicy, PinAttemptService],
})
export class AuthModule {}
