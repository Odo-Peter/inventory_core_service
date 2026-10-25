import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StoreResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ nullable: true })
  address: string | null;

  @ApiPropertyOptional({ nullable: true })
  phone: string | null;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  timezone: string;

  @ApiPropertyOptional({ nullable: true })
  receipt_footer: string | null;

  @ApiProperty()
  active: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updated_at: Date;
}
