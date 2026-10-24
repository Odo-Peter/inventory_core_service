import { Module } from '@nestjs/common';
import { SalesService } from './sales.service.js';
import { SalesController } from './sales.controller.js';

@Module({
  controllers: [SalesController],
  providers: [SalesService],
})
export class SalesModule {}
