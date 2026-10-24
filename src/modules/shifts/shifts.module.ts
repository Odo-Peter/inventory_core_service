import { Module } from '@nestjs/common';
import { ShiftsService } from './shifts.service.js';
import { ShiftsController } from './shifts.controller.js';

@Module({
  controllers: [ShiftsController],
  providers: [ShiftsService],
})
export class ShiftsModule {}
