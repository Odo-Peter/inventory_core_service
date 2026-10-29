import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';

import { ApiPaginatedResponse } from '../../common/pagination/api-paginated-response.decorator.js';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { Principal } from '../auth/principal.js';
import {
  ChangeItemPriceDto,
  CreateItemDto,
  ItemListResponseDto,
  ItemResponseDto,
  ListItemsQueryDto,
  PriceHistoryListResponseDto,
  PriceHistoryResponseDto,
  UpdateItemDto,
} from './dto/item.dto.js';
import { ItemsService } from './items.service.js';
import { FileInterceptor } from '@nestjs/platform-express';
import { MAX_IMAGE_BYTES } from './image/image-storage.js';

@ApiTags('Catalog')
@ApiBearerAuth()
@Controller('items')
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Roles('cashier')
  @Get()
  @ApiOperation({ summary: 'List catalog items' })
  @ApiPaginatedResponse(ItemResponseDto)
  list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ListItemsQueryDto,
  ): Promise<ItemListResponseDto> {
    return this.itemsService.list(principal, query);
  }

  @Roles('cashier')
  @Get('barcode/:barcode')
  @ApiOperation({ summary: 'Look up an item by exact barcode' })
  @ApiParam({ name: 'barcode' })
  @ApiOkResponse({ type: ItemResponseDto })
  findByBarcode(
    @CurrentPrincipal() principal: Principal,
    @Param('barcode') barcode: string,
  ): Promise<ItemResponseDto> {
    return this.itemsService.findByBarcode(principal, barcode);
  }

  @Roles('cashier')
  @Get(':id')
  @ApiOperation({ summary: 'Get a catalog item' })
  @ApiOkResponse({ type: ItemResponseDto })
  findOne(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ItemResponseDto> {
    return this.itemsService.findOne(principal, id);
  }

  @Roles('cashier')
  @Get(':id/price-history')
  @ApiOperation({ summary: 'List price history for an item' })
  @ApiPaginatedResponse(PriceHistoryResponseDto)
  listPriceHistory(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<PriceHistoryListResponseDto> {
    return this.itemsService.listPriceHistory(principal, id, query);
  }

  @Roles('manager')
  @Post()
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: MAX_IMAGE_BYTES } }),
  )
  @ApiOperation({
    summary:
      'Create a catalog item with zero stock and an optional image (SKU is generated)',
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    schema: {
      allOf: [
        { $ref: getSchemaPath(CreateItemDto) },
        {
          type: 'object',
          properties: { image: { type: 'string', format: 'binary' } },
        },
      ],
    },
  })
  @ApiCreatedResponse({ type: ItemResponseDto })
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateItemDto,
    @UploadedFile() image: Express.Multer.File | undefined,
  ): Promise<ItemResponseDto> {
    return this.itemsService.create(principal, dto, image);
  }

  @Roles('manager')
  @Patch(':id')
  @ApiOperation({ summary: 'Update catalog item details (not price or stock)' })
  @ApiOkResponse({ type: ItemResponseDto })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateItemDto,
  ): Promise<ItemResponseDto> {
    return this.itemsService.update(principal, id, dto);
  }

  @Roles('manager')
  @Post(':id/price')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change an item price' })
  @ApiOkResponse({ type: ItemResponseDto })
  changePrice(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeItemPriceDto,
  ): Promise<ItemResponseDto> {
    return this.itemsService.changePrice(principal, id, dto);
  }

  @Roles('admin')
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a catalog item' })
  @ApiOkResponse({ type: ItemResponseDto })
  deactivate(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ItemResponseDto> {
    return this.itemsService.deactivate(principal, id);
  }
}
