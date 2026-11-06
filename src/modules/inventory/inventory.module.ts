import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { InventoryController } from './inventory.controller.js';
import { StockService } from './stock.service.js';

@Module({
  imports: [AuditModule],
  controllers: [InventoryController],
  providers: [StockService],
  exports: [StockService],
})
export class InventoryModule {}
