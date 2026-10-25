import 'dotenv/config';

export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  nodeEnv: string;
  port: number;
  corsOrigins: string[];
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  jwtAccessTtlSeconds: number;
  pinPepper: string;
  lockoutThreshold: number;
  lockoutMinutes: number[];
  loginThrottleIpPerMin: number;
  loginThrottleCodePerMin: number;
}

const DEFAULT_ACCESS_TTL = '8h';
const DEFAULT_LOCKOUT_THRESHOLD = '5';
const DEFAULT_LOCKOUT_MINUTES = '5,15,60';
const DEFAULT_LOGIN_THROTTLE_IP_PER_MIN = '10';
const DEFAULT_LOGIN_THROTTLE_CODE_PER_MIN = '5';
const MIN_JWT_SECRET_BYTES = 32;
const MIN_PIN_PEPPER_BYTES = 16;

function requireValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set`);
  }
  return value;
}

function parsePositiveInteger(
  name: string,
  value: string,
  minimum = 1,
): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be at least ${minimum}`);
  }
  return parsed;
}

export function parseDurationSeconds(value: string): number {
  const trimmed = value.trim();

  if (/^\d+$/.test(trimmed)) {
    return parsePositiveInteger('JWT_ACCESS_TTL', trimmed);
  }

  const match = /^(\d+)([smhd])$/.exec(trimmed);
  if (!match) {
    throw new Error('JWT_ACCESS_TTL must be seconds or a duration such as 8h');
  }

  const amount = parsePositiveInteger('JWT_ACCESS_TTL', match[1]);
  const multiplier = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 24 * 60 * 60,
  }[match[2] as 's' | 'm' | 'h' | 'd'];

  return amount * multiplier;
}

function parseCsvIntegers(name: string, value: string): number[] {
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    throw new Error(`${name} must contain at least one value`);
  }

  return parts.map((part) => parsePositiveInteger(name, part));
}

function parseCorsOrigins(env: NodeJS.ProcessEnv, nodeEnv: string): string[] {
  const configured = env.CORS_ORIGINS?.trim();
  if (!configured) {
    if (nodeEnv === 'production') {
      throw new Error('CORS_ORIGINS must be configured in production');
    }
    return ['http://localhost:5173'];
  }

  const origins = configured
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error('CORS_ORIGINS must contain at least one origin');
  }
  if (origins.includes('*')) {
    throw new Error('CORS_ORIGINS must not contain a wildcard');
  }

  return origins;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV?.trim() || 'development';
  const jwtSecret = requireValue(env, 'JWT_SECRET');
  const pinPepper = requireValue(env, 'PIN_PEPPER');

  if (Buffer.byteLength(jwtSecret, 'utf8') < MIN_JWT_SECRET_BYTES) {
    throw new Error(
      `JWT_SECRET must be at least ${MIN_JWT_SECRET_BYTES} bytes`,
    );
  }
  if (Buffer.byteLength(pinPepper, 'utf8') < MIN_PIN_PEPPER_BYTES) {
    throw new Error(
      `PIN_PEPPER must be at least ${MIN_PIN_PEPPER_BYTES} bytes`,
    );
  }

  return {
    nodeEnv,
    port: parsePositiveInteger('PORT', env.PORT?.trim() || '3000'),
    corsOrigins: parseCorsOrigins(env, nodeEnv),
    jwtSecret,
    jwtIssuer: requireValue(env, 'JWT_ISSUER'),
    jwtAudience: requireValue(env, 'JWT_AUDIENCE'),
    jwtAccessTtlSeconds: parseDurationSeconds(
      env.JWT_ACCESS_TTL?.trim() || DEFAULT_ACCESS_TTL,
    ),
    pinPepper,
    lockoutThreshold: parsePositiveInteger(
      'LOCKOUT_THRESHOLD',
      env.LOCKOUT_THRESHOLD?.trim() || DEFAULT_LOCKOUT_THRESHOLD,
    ),
    lockoutMinutes: parseCsvIntegers(
      'LOCKOUT_MINUTES',
      env.LOCKOUT_MINUTES?.trim() || DEFAULT_LOCKOUT_MINUTES,
    ),
    loginThrottleIpPerMin: parsePositiveInteger(
      'LOGIN_THROTTLE_IP_PER_MIN',
      env.LOGIN_THROTTLE_IP_PER_MIN?.trim() ||
        DEFAULT_LOGIN_THROTTLE_IP_PER_MIN,
    ),
    loginThrottleCodePerMin: parsePositiveInteger(
      'LOGIN_THROTTLE_CODE_PER_MIN',
      env.LOGIN_THROTTLE_CODE_PER_MIN?.trim() ||
        DEFAULT_LOGIN_THROTTLE_CODE_PER_MIN,
    ),
  };
}
