import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';

import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { Principal } from '../auth/principal.js';
import { ItemImageResponseDto } from './dto/item-image.dto.js';
import { MAX_IMAGE_BYTES } from './image/image-storage.js';
import { ItemImagesService } from './item-images.service.js';

@ApiTags('Catalog')
@ApiBearerAuth()
@Roles('manager')
@Controller('items')
export class ItemImagesController {
  constructor(private readonly itemImagesService: ItemImagesService) {}

  @Put(':id/image')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: MAX_IMAGE_BYTES } }),
  )
  @ApiOperation({ summary: 'Upload or replace an item image' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image'],
      properties: { image: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ type: ItemImageResponseDto })
  @ApiConflictResponse({
    description: 'image_changed: the image was replaced concurrently',
  })
  @ApiServiceUnavailableResponse({
    description: 'image_storage_not_configured or image_storage_unavailable',
  })
  upload(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() image: Express.Multer.File | undefined,
  ): Promise<ItemImageResponseDto> {
    return this.itemImagesService.upload(principal, id, image);
  }

  @Delete(':id/image')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove an item image (idempotent)' })
  @ApiOkResponse({ type: ItemImageResponseDto })
  remove(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ItemImageResponseDto> {
    return this.itemImagesService.remove(principal, id);
  }
}
