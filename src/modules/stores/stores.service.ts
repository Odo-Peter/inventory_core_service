import { Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception.js';
import type { StoreModel } from '../../generated/prisma/models.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Principal } from '../auth/principal.js';
import type { UpdateStoreDto } from './dto/update-store.dto.js';
import type { StoreResponseDto } from './dto/store-response.dto.js';

function toStoreResponse(store: StoreModel): StoreResponseDto {
  return {
    id: store.id,
    name: store.name,
    address: store.address,
    phone: store.phone,
    currency: store.currency,
    timezone: store.timezone,
    receipt_footer: store.receipt_footer,
    active: store.active,
    created_at: store.created_at,
    updated_at: store.updated_at,
  };
}

@Injectable()
export class StoresService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrent(principal: Principal): Promise<StoreResponseDto> {
    const store = await this.prisma.store.findUnique({
      where: { id: principal.store_id },
    });

    if (!store) {
      throw new AppException(404, 'store_not_found', 'Store not found');
    }

    return toStoreResponse(store);
  }

  async updateCurrent(
    principal: Principal,
    dto: UpdateStoreDto,
  ): Promise<StoreResponseDto> {
    const data: {
      name?: string;
      address?: string;
      phone?: string;
      receipt_footer?: string;
    } = {};

    if (dto.name !== undefined) {
      data.name = dto.name;
    }
    if (dto.address !== undefined) {
      data.address = dto.address;
    }
    if (dto.phone !== undefined) {
      data.phone = dto.phone;
    }
    if (dto.receipt_footer !== undefined) {
      data.receipt_footer = dto.receipt_footer;
    }

    const store = await this.prisma.store.update({
      where: { id: principal.store_id },
      data,
    });

    return toStoreResponse(store);
  }
}
