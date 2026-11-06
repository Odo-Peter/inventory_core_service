import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ImageVariantUrlsDto {
  @ApiProperty()
  thumb: string;

  @ApiProperty()
  full: string;
}

export class ItemImageResponseDto {
  @ApiProperty()
  item_id: string;

  @ApiPropertyOptional({ nullable: true })
  image_key: string | null;

  @ApiPropertyOptional({ type: ImageVariantUrlsDto, nullable: true })
  variants: ImageVariantUrlsDto | null;
}
