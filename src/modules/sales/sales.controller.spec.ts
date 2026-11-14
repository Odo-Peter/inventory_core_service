import { describe, expect, it, vi } from 'vitest';

import type { Principal } from '../auth/principal.js';
import type { CreateSaleDto } from './dto/create-sale.dto.js';
import type { ListSalesQueryDto } from './dto/list-sales-query.dto.js';
import { SalesController } from './sales.controller.js';
import type { SalesService } from './sales.service.js';

const PRINCIPAL: Principal = {
  staff_id: '11111111-1111-4111-8111-111111111111',
  store_id: '22222222-2222-4222-8222-222222222222',
  role: 'cashier',
  timezone: 'UTC',
};

const SALE_ID = '66666666-6666-4666-8666-666666666666';

function buildController() {
  const service = {
    create: vi.fn().mockResolvedValue({ id: SALE_ID }),
    list: vi.fn().mockResolvedValue({ data: [], meta: {} }),
    findOne: vi.fn().mockResolvedValue({ id: SALE_ID }),
    summary: vi.fn().mockResolvedValue({}),
    overview: vi.fn().mockResolvedValue({}),
    paymentOptions: vi.fn().mockResolvedValue({}),
    printReceipt: vi.fn().mockResolvedValue({}),
  };

  return {
    controller: new SalesController(service as unknown as SalesService),
    service,
  };
}

describe('SalesController', () => {
  it('delegates each route to the service with the principal', async () => {
    const { controller, service } = buildController();
    const dto = {} as CreateSaleDto;
    const query = {} as ListSalesQueryDto;

    await controller.create(PRINCIPAL, dto);
    await controller.list(PRINCIPAL, query);
    await controller.findOne(PRINCIPAL, SALE_ID);
    await controller.summary(PRINCIPAL, query);
    await controller.overview(PRINCIPAL);
    await controller.paymentOptions(PRINCIPAL);
    await controller.printReceipt(PRINCIPAL, SALE_ID);

    expect(service.create).toHaveBeenCalledWith(PRINCIPAL, dto);
    expect(service.list).toHaveBeenCalledWith(PRINCIPAL, query);
    expect(service.findOne).toHaveBeenCalledWith(PRINCIPAL, SALE_ID);
    expect(service.summary).toHaveBeenCalledWith(PRINCIPAL, query);
    expect(service.overview).toHaveBeenCalledWith(PRINCIPAL);
    expect(service.paymentOptions).toHaveBeenCalledWith(PRINCIPAL);
    expect(service.printReceipt).toHaveBeenCalledWith(PRINCIPAL, SALE_ID);
  });
});
