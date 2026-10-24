import { Injectable } from '@nestjs/common';
import { CreateAuditDto } from './dto/create-audit.dto.js';
import { UpdateAuditDto } from './dto/update-audit.dto.js';

@Injectable()
export class AuditService {
  create(createAuditDto: CreateAuditDto) {
    return 'This action adds a new audit';
  }

  findAll() {
    return `This action returns all audit`;
  }

  findOne(id: number) {
    return `This action returns a #${id} audit`;
  }

  update(id: number, updateAuditDto: UpdateAuditDto) {
    return `This action updates a #${id} audit`;
  }

  remove(id: number) {
    return `This action removes a #${id} audit`;
  }
}
