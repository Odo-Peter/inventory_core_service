import { Test, TestingModule } from '@nestjs/testing';
import {
  DiskHealthIndicator,
  HealthCheckService,
  MemoryHealthIndicator,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheckService: HealthCheckService;

  const mockHealthResult = {
    status: 'ok',
    info: {
      memory_heap: { status: 'up' },
      memory_rss: { status: 'up' },
      disk: { status: 'up' },
      database: { status: 'up' },
    },
    error: {},
    details: {
      memory_heap: { status: 'up' },
      memory_rss: { status: 'up' },
      disk: { status: 'up' },
      database: { status: 'up' },
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthCheckService,
          useValue: {
            check: vi
              .fn()
              .mockImplementation(
                async (indicators: Array<() => Promise<unknown>>) => {
                  await Promise.all(indicators.map((indicator) => indicator()));
                  return mockHealthResult;
                },
              ),
          },
        },
        {
          provide: MemoryHealthIndicator,
          useValue: {
            checkHeap: vi
              .fn()
              .mockResolvedValue({ memory_heap: { status: 'up' } }),
            checkRSS: vi
              .fn()
              .mockResolvedValue({ memory_rss: { status: 'up' } }),
          },
        },
        {
          provide: DiskHealthIndicator,
          useValue: {
            checkStorage: vi.fn().mockResolvedValue({ disk: { status: 'up' } }),
          },
        },
        {
          provide: PrismaHealthIndicator,
          useValue: {
            pingCheck: vi
              .fn()
              .mockResolvedValue({ database: { status: 'up' } }),
          },
        },
        {
          provide: PrismaService,
          useValue: {}, // PrismaService is only passed to pingCheck
        },
      ],
    }).compile();

    controller = module.get(HealthController);
    healthCheckService = module.get(HealthCheckService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('checkLiveness', () => {
    it('should call memory health indicators', async () => {
      const result = await controller.checkLiveness();

      expect(healthCheckService.check).toHaveBeenCalled();
      expect(result).toEqual(mockHealthResult);
    });
  });

  describe('checkReadiness', () => {
    it('should call memory, disk and database health indicators', async () => {
      const result = await controller.checkReadiness();

      expect(healthCheckService.check).toHaveBeenCalled();
      expect(result).toEqual(mockHealthResult);
    });
  });

  describe('check', () => {
    it('should return readiness result', async () => {
      const result = await controller.check();
      expect(result).toEqual(mockHealthResult);
    });
  });
});
