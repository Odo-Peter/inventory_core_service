import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';

import { AllowPinChange } from './decorators/allow-pin-change.decorator.js';
import { CurrentPrincipal } from './decorators/current-principal.decorator.js';
import { Public } from './decorators/public.decorator.js';
import { Roles } from './decorators/roles.decorator.js';
import { AuthService } from './auth.service.js';
import {
  LoginResponseDto,
  LogoutResponseDto,
  MeResponseDto,
} from './dto/auth-response.dto.js';
import { ChangePinDto } from './dto/change-pin.dto.js';
import { LoginDto } from './dto/login.dto.js';
import type { Principal } from './principal.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in with a staff code and PIN' })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials' })
  login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    return this.authService.login(dto);
  }

  @Roles('cashier')
  @AllowPinChange()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Log out and revoke all tokens' })
  @ApiOkResponse({ type: LogoutResponseDto })
  logout(
    @CurrentPrincipal() principal: Principal,
  ): Promise<{ success: boolean }> {
    return this.authService.logout(principal);
  }

  @Roles('cashier')
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the current staff member' })
  @ApiOkResponse({ type: MeResponseDto })
  me(@CurrentPrincipal() principal: Principal): Promise<MeResponseDto> {
    return this.authService.me(principal);
  }

  @Roles('cashier')
  @AllowPinChange()
  @Post('change-pin')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change the current staff PIN' })
  @ApiOkResponse({ type: LoginResponseDto })
  changePin(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: ChangePinDto,
  ): Promise<LoginResponseDto> {
    return this.authService.changePin(principal, dto);
  }
}
