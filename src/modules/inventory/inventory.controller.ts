import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ApiPaginatedResponse } from '../../common/pagination/api-paginated-response.decorator.js';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { Principal } from '../auth/principal.js';
import {
  AdjustStockDto,
  DamageStockDto,
  InitialStockDto,
  ReceiveStockDto,
  ReconciliationItemDto,
  ReconciliationListResponseDto,
  StockMovementListResponseDto,
  StockMovementResponseDto,
  StockStatusResponseDto,
} from './dto/stock.dto.js';
import { StockService } from './stock.service.js';

@ApiTags('Inventory')
@ApiBearerAuth()
@Roles('manager')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly stockService: StockService) {}

  @Post('items/:id/initial')
  @ApiOperation({ summary: 'Record opening stock once for an item' })
  @ApiCreatedResponse({ type: StockMovementResponseDto })
  initialize(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InitialStockDto,
  ): Promise<StockMovementResponseDto> {
    return this.stockService.initialize(principal, id, dto);
  }

  @Post('items/:id/receive')
  @ApiOperation({ summary: 'Receive stock for an item' })
  @ApiCreatedResponse({ type: StockMovementResponseDto })
  receive(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceiveStockDto,
  ): Promise<StockMovementResponseDto> {
    return this.stockService.receive(principal, id, dto);
  }

  @Post('items/:id/adjust')
  @ApiOperation({ summary: 'Adjust stock by a signed quantity' })
  @ApiOkResponse({ type: StockMovementResponseDto })
  adjust(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustStockDto,
  ): Promise<StockMovementResponseDto> {
    return this.stockService.adjust(principal, id, dto);
  }

  @Post('items/:id/damage')
  @ApiOperation({ summary: 'Record damaged stock' })
  @ApiCreatedResponse({ type: StockMovementResponseDto })
  damage(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DamageStockDto,
  ): Promise<StockMovementResponseDto> {
    return this.stockService.recordDamage(principal, id, dto);
  }

  @Get('items/:id/movements')
  @ApiOperation({ summary: 'List stock movements for an item' })
  @ApiPaginatedResponse(StockMovementResponseDto)
  listMovements(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<StockMovementListResponseDto> {
    return this.stockService.listMovements(principal, id, query);
  }

  @Get('items/:id/stock-status')
  @ApiOperation({
    summary: 'Whether opening stock is still allowed for an item (read-only)',
  })
  @ApiOkResponse({ type: StockStatusResponseDto })
  stockStatus(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StockStatusResponseDto> {
    return this.stockService.getStockStatus(principal, id);
  }

  @Roles('admin')
  @Get('reconciliation')
  @ApiOperation({ summary: 'Detect stock cache drift (read-only)' })
  @ApiPaginatedResponse(ReconciliationItemDto)
  reconciliation(
    @CurrentPrincipal() principal: Principal,
    @Query() query: PaginationQueryDto,
  ): Promise<ReconciliationListResponseDto> {
    return this.stockService.reconciliation(principal, query);
  }
}
