import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { ApiPaginatedResponse } from '../../common/pagination/api-paginated-response.decorator.js';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { Principal } from '../auth/principal.js';
import {
  CreateSaleDto,
  CreateSaleItemDto,
} from './dto/create-sale.dto.js';
import { ListSalesQueryDto } from './dto/list-sales-query.dto.js';
import {
  PaymentAccountOptionDto,
  PaymentMethodOptionDto,
  PaymentOptionsResponseDto,
  ReceiptResponseDto,
  ReceiptStoreDto,
  SaleItemResponseDto,
  SaleListItemDto,
  SaleListResponseDto,
  SalePaymentResponseDto,
  SaleResponseDto,
  SalesOverviewDayDto,
  SalesOverviewPaymentMethodDto,
  SalesOverviewResponseDto,
  SalesOverviewTodayDto,
  SalesSummaryPaymentMethodDto,
  SalesSummaryResponseDto,
} from './dto/sale.dto.js';
import { SalesService } from './sales.service.js';

@ApiTags('Sales')
@ApiBearerAuth()
@ApiExtraModels(
  CreateSaleItemDto,
  SaleItemResponseDto,
  SalePaymentResponseDto,
  ReceiptStoreDto,
  PaymentAccountOptionDto,
  PaymentMethodOptionDto,
  SalesOverviewDayDto,
  SalesOverviewPaymentMethodDto,
  SalesOverviewTodayDto,
  SalesSummaryPaymentMethodDto,
)
@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Roles('cashier')
  @Post()
  @ApiOperation({ summary: 'Record a completed sale and its payment' })
  @ApiCreatedResponse({ type: SaleResponseDto })
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateSaleDto,
  ): Promise<SaleResponseDto> {
    return this.salesService.create(principal, dto);
  }

  @Roles('cashier')
  @Get('payment-options')
  @ApiOperation({ summary: 'List enabled payment methods and accounts' })
  @ApiOkResponse({ type: PaymentOptionsResponseDto })
  paymentOptions(
    @CurrentPrincipal() principal: Principal,
  ): Promise<PaymentOptionsResponseDto> {
    return this.salesService.paymentOptions(principal);
  }

  @Roles('cashier')
  @Get('summary')
  @ApiOperation({ summary: 'Summarise sales in a date range or shift' })
  @ApiOkResponse({ type: SalesSummaryResponseDto })
  summary(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ListSalesQueryDto,
  ): Promise<SalesSummaryResponseDto> {
    return this.salesService.summary(principal, query);
  }

  @Roles('cashier')
  @Get('overview')
  @ApiOperation({ summary: 'Get the dashboard sales overview' })
  @ApiOkResponse({ type: SalesOverviewResponseDto })
  overview(
    @CurrentPrincipal() principal: Principal,
  ): Promise<SalesOverviewResponseDto> {
    return this.salesService.overview(principal);
  }

  @Roles('cashier')
  @Get()
  @ApiOperation({ summary: 'List completed sales' })
  @ApiPaginatedResponse(SaleListItemDto)
  list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ListSalesQueryDto,
  ): Promise<SaleListResponseDto> {
    return this.salesService.list(principal, query);
  }

  @Roles('cashier')
  @Get(':id')
  @ApiOperation({ summary: 'Get a completed sale' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SaleResponseDto })
  findOne(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SaleResponseDto> {
    return this.salesService.findOne(principal, id);
  }

  @Roles('cashier')
  @Post(':id/receipt-prints')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a receipt print or reprint' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReceiptResponseDto })
  printReceipt(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReceiptResponseDto> {
    return this.salesService.printReceipt(principal, id);
  }
}
