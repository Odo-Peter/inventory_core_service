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
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { Principal } from '../auth/principal.js';
import { ActingPinDto } from './dto/acting-pin.dto.js';
import { CreateStaffDto } from './dto/create-staff.dto.js';
import {
  StaffResponseDto,
  StaffWithTemporaryPinDto,
} from './dto/staff-response.dto.js';
import { UpdateStaffDto } from './dto/update-staff.dto.js';
import { UsersService } from './users.service.js';
import type { StaffResponse } from './staff.mapper.js';

@ApiTags('staff')
@ApiBearerAuth()
@Controller('staff')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Roles('manager')
  @Get()
  @ApiOperation({ summary: 'List staff in the current store' })
  @ApiOkResponse({ type: [StaffResponseDto] })
  list(@CurrentPrincipal() principal: Principal): Promise<StaffResponse[]> {
    return this.usersService.list(principal);
  }

  @Roles('manager')
  @Get(':id')
  @ApiOperation({ summary: 'Get a staff member' })
  @ApiOkResponse({ type: StaffResponseDto })
  findOne(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StaffResponse> {
    return this.usersService.findOne(principal, id);
  }

  @Roles('admin')
  @Post()
  @ApiOperation({ summary: 'Create a staff member with a temporary PIN' })
  @ApiCreatedResponse({ type: StaffWithTemporaryPinDto })
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateStaffDto,
  ) {
    return this.usersService.create(principal, dto);
  }

  @Roles('admin')
  @Patch(':id')
  @ApiOperation({ summary: 'Update a staff name or role' })
  @ApiOkResponse({ type: StaffResponseDto })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffDto,
  ): Promise<StaffResponse> {
    return this.usersService.update(principal, id, dto);
  }

  @Roles('admin')
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a staff member' })
  @ApiOkResponse({ type: StaffResponseDto })
  deactivate(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StaffResponse> {
    return this.usersService.deactivate(principal, id);
  }

  @Roles('admin')
  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactivate a staff member' })
  @ApiOkResponse({ type: StaffResponseDto })
  reactivate(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StaffResponse> {
    return this.usersService.reactivate(principal, id);
  }

  @Roles('manager')
  @Post(':id/reset-pin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset a staff PIN with the caller PIN' })
  @ApiOkResponse({ type: StaffWithTemporaryPinDto })
  resetPin(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActingPinDto,
  ) {
    return this.usersService.resetPin(principal, id, dto);
  }

  @Roles('manager')
  @Post(':id/unlock')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unlock a staff account' })
  @ApiOkResponse({ type: StaffResponseDto })
  unlock(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActingPinDto,
  ): Promise<StaffResponse> {
    return this.usersService.unlock(principal, id, dto);
  }
}
