import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { Principal } from '../auth/principal.js';
import { StoreResponseDto } from './dto/store-response.dto.js';
import { UpdateStoreDto } from './dto/update-store.dto.js';
import { StoresService } from './stores.service.js';

@ApiTags('stores')
@ApiBearerAuth()
@Controller('stores')
export class StoresController {
  constructor(private readonly storesService: StoresService) {}

  @Roles('cashier')
  @Get('current')
  @ApiOperation({ summary: 'Get the current store' })
  @ApiOkResponse({ type: StoreResponseDto })
  getCurrent(
    @CurrentPrincipal() principal: Principal,
  ): Promise<StoreResponseDto> {
    return this.storesService.getCurrent(principal);
  }

  @Roles('admin')
  @Patch('current')
  @ApiOperation({ summary: 'Update editable store details' })
  @ApiOkResponse({ type: StoreResponseDto })
  updateCurrent(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: UpdateStoreDto,
  ): Promise<StoreResponseDto> {
    return this.storesService.updateCurrent(principal, dto);
  }
}
