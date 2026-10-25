import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class ActingPinDto {
  @ApiProperty({ description: "The caller's own current PIN" })
  @IsString()
  @Matches(/^\d{4,6}$/)
  acting_pin: string;
}
