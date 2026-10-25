import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { AppException } from '../../common/errors/app.exception.js';

export interface AccessTokenClaims {
  sub: string;
  store_id: string;
  tv: number;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
  jti: string;
}

export interface AccessToken {
  accessToken: string;
  expiresIn: number;
}

interface AccessTokenPayload {
  sub: string;
  store_id: string;
  tv: number;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async sign(
    staffId: string,
    storeId: string,
    tokenVersion: number,
  ): Promise<AccessToken> {
    const payload: AccessTokenPayload = {
      sub: staffId,
      store_id: storeId,
      tv: tokenVersion,
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.jwtSecret,
      algorithm: 'HS256',
      expiresIn: this.config.jwtAccessTtlSeconds,
      issuer: this.config.jwtIssuer,
      audience: this.config.jwtAudience,
      jwtid: randomUUID(),
    });

    return {
      accessToken,
      expiresIn: this.config.jwtAccessTtlSeconds,
    };
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    try {
      const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        secret: this.config.jwtSecret,
        algorithms: ['HS256'],
        issuer: this.config.jwtIssuer,
        audience: this.config.jwtAudience,
      });

      if (
        typeof claims.sub !== 'string' ||
        typeof claims.store_id !== 'string' ||
        typeof claims.tv !== 'number' ||
        typeof claims.jti !== 'string'
      ) {
        throw new Error('Token claims are incomplete');
      }

      return claims;
    } catch {
      throw new AppException(401, 'unauthorized', 'Invalid or expired token');
    }
  }
}
