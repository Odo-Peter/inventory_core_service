import { Module } from '@nestjs/common';
import { DevicesService } from './devices.service.js';
import { DevicesController } from './devices.controller.js';

@Module({
  controllers: [DevicesController],
  providers: [DevicesService],
})
export class DevicesModule {}
