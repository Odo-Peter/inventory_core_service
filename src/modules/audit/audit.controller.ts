import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { Principal } from '../auth/principal.js';
import { AuditQueryService } from './audit-query.service.js';
import {
  AuditLogActionsResponseDto,
  AuditLogListResponseDto,
} from './dto/audit-log-response.dto.js';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto.js';

@ApiTags('audit')
@ApiBearerAuth()
@Roles('admin')
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly auditQuery: AuditQueryService) {}

  @Get()
  @ApiOperation({ summary: 'List audit log entries for the current store' })
  @ApiOkResponse({ type: AuditLogListResponseDto })
  list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ListAuditLogsQueryDto,
  ): Promise<AuditLogListResponseDto> {
    return this.auditQuery.list(principal, query);
  }

  @Get('actions')
  @ApiOperation({ summary: 'List the known audit actions' })
  @ApiOkResponse({ type: AuditLogActionsResponseDto })
  actions(): AuditLogActionsResponseDto {
    return { actions: this.auditQuery.listActions() };
  }
}
