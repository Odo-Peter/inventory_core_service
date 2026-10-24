import { Module } from '@nestjs/common';
import { StoresService } from './stores.service.js';
import { StoresController } from './stores.controller.js';

@Module({
  controllers: [StoresController],
  providers: [StoresService],
})
export class StoresModule {}
