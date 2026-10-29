import {
  Body,
  Controller,
  Get,
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
import { CategoriesService } from './categories.service.js';
import type { ListCategoriesQueryDto } from './dto/catalog-query.dto.js';
import {
  CategoryListResponseDto,
  CategoryResponseDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from './dto/category.dto.js';

@ApiTags('Catalog')
@ApiBearerAuth()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Roles('cashier')
  @Get()
  @ApiOperation({ summary: 'List categories' })
  @ApiPaginatedResponse(CategoryResponseDto)
  list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ListCategoriesQueryDto,
  ): Promise<CategoryListResponseDto> {
    return this.categoriesService.list(principal, query);
  }

  @Roles('cashier')
  @Get(':id')
  @ApiOperation({ summary: 'Get a category' })
  @ApiOkResponse({ type: CategoryResponseDto })
  findOne(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CategoryResponseDto> {
    return this.categoriesService.findOne(principal, id);
  }

  @Roles('admin')
  @Post()
  @ApiOperation({ summary: 'Create a category' })
  @ApiCreatedResponse({ type: CategoryResponseDto })
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateCategoryDto,
  ): Promise<CategoryResponseDto> {
    return this.categoriesService.create(principal, dto);
  }

  @Roles('admin')
  @Patch(':id')
  @ApiOperation({ summary: 'Update a category' })
  @ApiOkResponse({ type: CategoryResponseDto })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryResponseDto> {
    return this.categoriesService.update(principal, id, dto);
  }
}
