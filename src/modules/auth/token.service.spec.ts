import { JwtService } from '@nestjs/jwt';
import { describe, expect, it } from 'vitest';

import type { AppConfig } from '../../config/app-config.js';
import { TokenService } from './token.service.js';

const baseConfig = {
  jwtSecret: 'a-secure-jwt-secret-with-32-bytes-minimum',
  jwtIssuer: 'inventory-core',
  jwtAudience: 'inventory-pos',
  jwtAccessTtlSeconds: 60,
} as AppConfig;

function createService(overrides: Partial<AppConfig> = {}): TokenService {
  const config = { ...baseConfig, ...overrides };
  return new TokenService(new JwtService({ secret: config.jwtSecret }), config);
}

describe('TokenService', () => {
  it('signs the expected claims without a role', async () => {
    const service = createService();
    const token = await service.sign('staff-1', 'store-1', 3);
    const claims = new JwtService().decode<Record<string, unknown>>(
      token.accessToken,
    );

    expect(token.expiresIn).toBe(60);
    expect(claims).toMatchObject({
      sub: 'staff-1',
      store_id: 'store-1',
      tv: 3,
      iss: 'inventory-core',
      aud: 'inventory-pos',
    });
    expect(claims).toHaveProperty('iat');
    expect(claims).toHaveProperty('exp');
    expect(claims).toHaveProperty('jti');
    expect(claims).not.toHaveProperty('role');
  });

  it('verifies a token it signed', async () => {
    const service = createService();
    const token = await service.sign('staff-1', 'store-1', 0);
    const claims = await service.verify(token.accessToken);

    expect(claims.sub).toBe('staff-1');
    expect(claims.store_id).toBe('store-1');
    expect(claims.tv).toBe(0);
  });

  it('rejects a tampered token', async () => {
    const service = createService();
    const token = await service.sign('staff-1', 'store-1', 0);
    const tampered = `${token.accessToken.slice(0, -1)}x`;

    await expect(service.verify(tampered)).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const service = createService();
    const expired = await new JwtService({
      secret: baseConfig.jwtSecret,
    }).signAsync(
      { sub: 'staff-1', store_id: 'store-1', tv: 0 },
      {
        algorithm: 'HS256',
        expiresIn: -1,
        issuer: baseConfig.jwtIssuer,
        audience: baseConfig.jwtAudience,
        jwtid: 'expired',
      },
    );

    await expect(service.verify(expired)).rejects.toThrow();
  });

  it('rejects the wrong issuer or audience', async () => {
    const signer = createService();
    const token = await signer.sign('staff-1', 'store-1', 0);

    await expect(
      createService({ jwtIssuer: 'other-issuer' }).verify(token.accessToken),
    ).rejects.toThrow();
    await expect(
      createService({ jwtAudience: 'other-audience' }).verify(
        token.accessToken,
      ),
    ).rejects.toThrow();
  });

  it('rejects a token signed with another secret', async () => {
    const signer = createService({
      jwtSecret: 'another-secure-jwt-secret-with-32-bytes',
    });
    const token = await signer.sign('staff-1', 'store-1', 0);

    await expect(createService().verify(token.accessToken)).rejects.toThrow();
  });

  it('rejects alg none', async () => {
    const service = createService();
    const header = Buffer.from(
      JSON.stringify({ alg: 'none', typ: 'JWT' }),
    ).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: 'staff-1',
        store_id: 'store-1',
        tv: 0,
        iss: baseConfig.jwtIssuer,
        aud: baseConfig.jwtAudience,
        exp: Math.floor(Date.now() / 1000) + 60,
        iat: Math.floor(Date.now() / 1000),
        jti: 'none',
      }),
    ).toString('base64url');

    await expect(service.verify(`${header}.${payload}.`)).rejects.toThrow();
  });
});
