import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import { ROLES_KEY } from '../auth/decorators/roles.decorator.js';
import type { Principal } from '../auth/principal.js';
import type { ListMovementsQueryDto } from './dto/list-movements-query.dto.js';
import { InventoryController } from './inventory.controller.js';
import { StockService } from './stock.service.js';

const PRINCIPAL: Principal = {
  staff_id: '11111111-1111-4111-8111-111111111111',
  store_id: '22222222-2222-4222-8222-222222222222',
  role: 'manager',
};

async function createController() {
  const stockService = {
    listStoreMovements: vi.fn(),
  };
  const moduleRef = await Test.createTestingModule({
    controllers: [InventoryController],
    providers: [{ provide: StockService, useValue: stockService }],
  }).compile();

  return {
    controller: moduleRef.get(InventoryController),
    stockService,
  };
}

function methodMetadata(handler: 'listStoreMovements' | 'reconciliation') {
  const method = Object.getOwnPropertyDescriptor(
    InventoryController.prototype,
    handler,
  )?.value;

  return Reflect.getMetadata(ROLES_KEY, method);
}

describe('InventoryController role metadata', () => {
  it('puts the whole controller behind the manager role', () => {
    expect(Reflect.getMetadata(ROLES_KEY, InventoryController)).toEqual([
      'manager',
    ]);
  });

  it('lets the store movements route inherit the manager role', () => {
    expect(methodMetadata('listStoreMovements')).toBeUndefined();
  });

  it('keeps reconciliation admin-only', () => {
    expect(methodMetadata('reconciliation')).toEqual(['admin']);
  });
});

describe('InventoryController.listStoreMovements', () => {
  it('delegates the principal and query to StockService', async () => {
    const { controller, stockService } = await createController();
    const query = {
      page: 1,
      page_size: 25,
    } as ListMovementsQueryDto;
    const response = { data: [], meta: {} };
    stockService.listStoreMovements.mockResolvedValue(response);

    await expect(
      controller.listStoreMovements(PRINCIPAL, query),
    ).resolves.toBe(response);
    expect(stockService.listStoreMovements).toHaveBeenCalledWith(
      PRINCIPAL,
      query,
    );
  });
});
