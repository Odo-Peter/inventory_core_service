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
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ApiPaginatedResponse } from '../../common/pagination/api-paginated-response.decorator.js';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { Principal } from '../auth/principal.js';
import {
  CreatePosAccountDto,
  ListPosAccountsQueryDto,
  PosAccountListResponseDto,
  PosAccountResponseDto,
  UpdatePosAccountDto,
} from './dto/pos-account.dto.js';
import { PosAccountsService } from './pos-accounts.service.js';

@ApiTags('POS Accounts')
@ApiBearerAuth()
@Roles('cashier')
@Controller('pos-accounts')
export class PosAccountsController {
  constructor(private readonly posAccountsService: PosAccountsService) {}

  @Get()
  @ApiOperation({ summary: 'List POS accounts' })
  @ApiPaginatedResponse(PosAccountResponseDto)
  list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ListPosAccountsQueryDto,
  ): Promise<PosAccountListResponseDto> {
    return this.posAccountsService.list(principal, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a POS account' })
  @ApiOkResponse({ type: PosAccountResponseDto })
  findOne(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PosAccountResponseDto> {
    return this.posAccountsService.findOne(principal, id);
  }

  @Roles('manager')
  @Post()
  @ApiOperation({ summary: 'Create a POS account' })
  @ApiCreatedResponse({ type: PosAccountResponseDto })
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreatePosAccountDto,
  ): Promise<PosAccountResponseDto> {
    return this.posAccountsService.create(principal, dto);
  }

  @Roles('manager')
  @Patch(':id')
  @ApiOperation({ summary: 'Update a POS account' })
  @ApiOkResponse({ type: PosAccountResponseDto })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePosAccountDto,
  ): Promise<PosAccountResponseDto> {
    return this.posAccountsService.update(principal, id, dto);
  }

  @Roles('manager')
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a POS account' })
  @ApiOkResponse({ type: PosAccountResponseDto })
  deactivate(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PosAccountResponseDto> {
    return this.posAccountsService.deactivate(principal, id);
  }
}
