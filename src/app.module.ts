import { Module } from '@nestjs/common';
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

@Module({
  imports: [HealthModule, AuthModule, UsersModule, StoresModule, DevicesModule, AuditModule, InventoryModule, SalesModule, PaymentsModule, ShiftsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
