import { Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { AuditController } from './audit.controller.js';

@Module({
  controllers: [AuditController],
  providers: [AuditService],
})
export class AuditModule {}
