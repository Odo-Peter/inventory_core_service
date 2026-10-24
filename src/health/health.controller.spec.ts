import { Test, TestingModule } from '@nestjs/testing';
import {
  DiskHealthIndicator,
  HealthCheckService,
  MemoryHealthIndicator,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheckService: HealthCheckService;
  let memoryIndicator: MemoryHealthIndicator;
  let diskIndicator: DiskHealthIndicator;
  let dbIndicator: TypeOrmHealthIndicator;

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
            // Important: actually execute the indicator functions
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
          provide: TypeOrmHealthIndicator,
          useValue: {
            pingCheck: vi
              .fn()
              .mockResolvedValue({ database: { status: 'up' } }),
          },
        },
      ],
    }).compile();

    controller = module.get(HealthController);
    healthCheckService = module.get(HealthCheckService);
    memoryIndicator = module.get(MemoryHealthIndicator);
    diskIndicator = module.get(DiskHealthIndicator);
    dbIndicator = module.get(TypeOrmHealthIndicator);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('checkLiveness', () => {
    it('should call memory health indicators', async () => {
      const result = await controller.checkLiveness();

      expect(healthCheckService.check).toHaveBeenCalled();
      expect(memoryIndicator.checkHeap).toHaveBeenCalled();
      expect(memoryIndicator.checkRSS).toHaveBeenCalled();
      expect(result).toEqual(mockHealthResult);
    });

    it('should not depend on the database', async () => {
      await controller.checkLiveness();

      expect(dbIndicator.pingCheck).not.toHaveBeenCalled();
    });
  });

  describe('checkReadiness', () => {
    it('should call memory, disk and database health indicators', async () => {
      const result = await controller.checkReadiness();

      expect(healthCheckService.check).toHaveBeenCalled();
      expect(memoryIndicator.checkHeap).toHaveBeenCalled();
      expect(memoryIndicator.checkRSS).toHaveBeenCalled();
      expect(diskIndicator.checkStorage).toHaveBeenCalled();
      expect(dbIndicator.pingCheck).toHaveBeenCalledWith(
        'database',
        expect.objectContaining({ timeout: expect.any(Number) }),
      );
      expect(result).toEqual(mockHealthResult);
    });

    it('should propagate a failing database check', async () => {
      vi.mocked(dbIndicator.pingCheck).mockRejectedValueOnce(
        new Error('connection refused'),
      );

      await expect(controller.checkReadiness()).rejects.toThrow(
        'connection refused',
      );
    });
  });

  describe('check', () => {
    it('should return readiness result including the database', async () => {
      const result = await controller.check();

      expect(dbIndicator.pingCheck).toHaveBeenCalled();
      expect(result).toEqual(mockHealthResult);
    });
  });
});
