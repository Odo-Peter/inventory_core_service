import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'ADMIN001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._-]+$/)
  staff_code: string;

  @ApiProperty({ example: '246810' })
  @IsString()
  @Matches(/^\d{4,6}$/)
  pin: string;
}
