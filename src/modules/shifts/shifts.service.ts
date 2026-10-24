import { Injectable } from '@nestjs/common';
import { CreateShiftDto } from './dto/create-shift.dto.js';
import { UpdateShiftDto } from './dto/update-shift.dto.js';

@Injectable()
export class ShiftsService {
  create(createShiftDto: CreateShiftDto) {
    return 'This action adds a new shift';
  }

  findAll() {
    return `This action returns all shifts`;
  }

  findOne(id: number) {
    return `This action returns a #${id} shift`;
  }

  update(id: number, updateShiftDto: UpdateShiftDto) {
    return `This action updates a #${id} shift`;
  }

  remove(id: number) {
    return `This action removes a #${id} shift`;
  }
}
