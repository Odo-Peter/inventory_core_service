import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import { ROLES_KEY } from '../auth/decorators/roles.decorator.js';
import type { Principal } from '../auth/principal.js';
import type { ListItemsQueryDto } from './dto/item.dto.js';
import { ItemUnit } from './item-unit.enum.js';
import { ItemsController } from './items.controller.js';
import { ItemsService } from './items.service.js';

const PRINCIPAL: Principal = {
  staff_id: '11111111-1111-4111-8111-111111111111',
  store_id: '22222222-2222-4222-8222-222222222222',
  role: 'cashier',
};

type ItemsHandler =
  | 'list'
  | 'listUnits'
  | 'findByBarcode'
  | 'findOne'
  | 'listPriceHistory'
  | 'create'
  | 'update'
  | 'changePrice'
  | 'deactivate';

const ROLE_MATRIX: Array<{
  handler: ItemsHandler;
  roles: string[];
}> = [
  { handler: 'list', roles: ['cashier'] },
  { handler: 'listUnits', roles: ['cashier'] },
  { handler: 'findByBarcode', roles: ['cashier'] },
  { handler: 'findOne', roles: ['cashier'] },
  { handler: 'listPriceHistory', roles: ['cashier'] },
  { handler: 'create', roles: ['manager'] },
  { handler: 'update', roles: ['manager'] },
  { handler: 'changePrice', roles: ['manager'] },
  { handler: 'deactivate', roles: ['admin'] },
];

async function createController() {
  const itemsService = {
    list: vi.fn(),
    findOne: vi.fn(),
    findByBarcode: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    changePrice: vi.fn(),
    deactivate: vi.fn(),
    listPriceHistory: vi.fn(),
  };
  const moduleRef = await Test.createTestingModule({
    controllers: [ItemsController],
    providers: [{ provide: ItemsService, useValue: itemsService }],
  }).compile();

  return {
    controller: moduleRef.get(ItemsController),
    itemsService,
  };
}

describe('ItemsController.listUnits', () => {
  it('returns every ItemUnit value without calling the service', async () => {
    const { controller, itemsService } = await createController();

    const result = controller.listUnits();

    expect(result).toEqual({ units: Object.values(ItemUnit) });
    expect(itemsService.list).not.toHaveBeenCalled();
  });
});

describe('ItemsController role metadata', () => {
  it.each(ROLE_MATRIX)(
    'protects $handler with $roles',
    async ({ handler, roles }) => {
      const metadata = Reflect.getMetadata(
        ROLES_KEY,
        ItemsController.prototype[handler],
      );

      expect(metadata).toEqual(roles);
    },
  );
});

describe('ItemsController delegation', () => {
  it('passes the principal and query to ItemsService.list', async () => {
    const { controller, itemsService } = await createController();
    const query = { page: 1, page_size: 25 } as ListItemsQueryDto;
    const response = { data: [], meta: {} };
    itemsService.list.mockResolvedValue(response);

    await expect(controller.list(PRINCIPAL, query)).resolves.toBe(response);
    expect(itemsService.list).toHaveBeenCalledWith(PRINCIPAL, query);
  });
});
