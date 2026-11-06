import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { PosAccountsController } from './pos-accounts.controller.js';
import { PosAccountsService } from './pos-accounts.service.js';

@Module({
  imports: [AuditModule],
  controllers: [PosAccountsController],
  providers: [PosAccountsService],
})
export class PaymentsModule {}
