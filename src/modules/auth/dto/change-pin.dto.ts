import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class ChangePinDto {
  @ApiProperty()
  @IsString()
  @Matches(/^\d{4,6}$/)
  current_pin: string;

  @ApiProperty()
  @IsString()
  @Matches(/^\d{4,6}$/)
  new_pin: string;
}
