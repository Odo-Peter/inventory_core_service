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
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator.js';
import { DenyRoles } from '../auth/decorators/deny-roles.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { Principal } from '../auth/principal.js';
import { ClockInDto } from './dto/clock-in.dto.js';
import { ClockOutDto } from './dto/clock-out.dto.js';
import { ForceCloseDto } from './dto/force-close.dto.js';
import { ListShiftsQueryDto } from './dto/list-shifts-query.dto.js';
import {
  ShiftListResponseDto,
  ShiftResponseDto,
} from './dto/shift-response.dto.js';
import { ShiftsService } from './shifts.service.js';

@ApiTags('shifts')
@ApiBearerAuth()
@Controller('shifts')
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Roles('cashier')
  @DenyRoles(['admin'], {
    message: 'Admins cannot start or close shifts. Use force-close instead.',
  })
  @Post('clock-in')
  @ApiOperation({ summary: 'Open a shift' })
  @ApiCreatedResponse({ type: ShiftResponseDto })
  clockIn(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: ClockInDto,
  ): Promise<ShiftResponseDto> {
    return this.shiftsService.clockIn(principal, dto);
  }

  @Roles('cashier')
  @DenyRoles(['admin'], {
    message: 'Admins cannot start or close shifts. Use force-close instead.',
  })
  @Post('clock-out')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close your open shift' })
  @ApiOkResponse({ type: ShiftResponseDto })
  clockOut(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: ClockOutDto,
  ): Promise<ShiftResponseDto> {
    return this.shiftsService.clockOut(principal, dto);
  }

  @Roles('cashier')
  @Get('current')
  @ApiOperation({ summary: 'Get your open shift' })
  @ApiOkResponse({ type: ShiftResponseDto })
  current(
    @CurrentPrincipal() principal: Principal,
  ): Promise<ShiftResponseDto | null> {
    return this.shiftsService.getCurrent(principal);
  }

  @Roles('manager')
  @Get()
  @ApiOperation({ summary: 'List shifts' })
  @ApiOkResponse({ type: ShiftListResponseDto })
  list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ListShiftsQueryDto,
  ): Promise<ShiftListResponseDto> {
    return this.shiftsService.list(principal, query);
  }

  @Roles('manager')
  @Post(':id/force-close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Force-close an open shift' })
  @ApiOkResponse({ type: ShiftResponseDto })
  forceClose(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ForceCloseDto,
  ): Promise<ShiftResponseDto> {
    return this.shiftsService.forceClose(principal, id, dto);
  }
}
